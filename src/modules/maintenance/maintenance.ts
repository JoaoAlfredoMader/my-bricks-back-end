import type { PrismaClient } from "../../lib/prisma.js";
import type { StorageProvider } from "../../lib/storage/storage.js";
import { createAuditRepository } from "../audit/audit.repository.js";
import { sweepOrphanFiles } from "../files/orphan-sweep.js";

export interface MaintenanceDeps {
  prisma: PrismaClient;
  storage: StorageProvider;
  /** The moment the run is made at; injectable for tests. */
  now?: Date;
  /** Audit entries older than this are purged. */
  auditRetentionDays?: number;
  /** Files younger than this are never swept (an upload may be in flight). */
  orphanGraceMinutes?: number;
}

export interface MaintenanceReport {
  expiredDemoOrganizations: number;
  anonymousUsersRemoved: number;
  orphanFilesSwept: number;
  auditEntriesPurged: number;
  expiredSessionsPurged: number;
  expiredVerificationsPurged: number;
}

const DAY_MS = 86_400_000;

/**
 * Deletes one demo organization and everything in it. Order matters: Postgres checks each step of
 * a cascade separately, so the tables that point at others with NO ACTION have to go first.
 * The objects in the storage are deleted before the rows that know their keys; if any object
 * cannot be deleted the organization is left for the next run, rather than orphaning it.
 */
async function deleteDemoOrganization(
  { prisma, storage }: Pick<MaintenanceDeps, "prisma" | "storage">,
  organizationId: string,
): Promise<{ deleted: boolean; ownerIds: string[] }> {
  const files = await prisma.storedFile.findMany({ where: { organizationId }, select: { storageKey: true } });
  for (const file of files) {
    try {
      await storage.delete(file.storageKey);
    } catch (error) {
      console.error(`Demo organization ${organizationId} kept: could not delete ${file.storageKey}`, error);
      return { deleted: false, ownerIds: [] };
    }
  }

  const members = await prisma.member.findMany({ where: { organizationId }, select: { userId: true } });
  await prisma.$transaction(async (tx) => {
    await tx.feedback.deleteMany({ where: { organizationId } }); // points at stored files
    await tx.property.deleteMany({ where: { organizationId } }); // cascades contracts, reservations, photos, documents, transactions...
    await tx.storedFile.deleteMany({ where: { organizationId } });
    await tx.client.deleteMany({ where: { organizationId } });
    await tx.occupant.deleteMany({ where: { organizationId } });
    await tx.agency.deleteMany({ where: { organizationId } });
    await tx.organization.delete({ where: { id: organizationId } }); // cascades members, invitations, template, audit logs
  });
  return { deleted: true, ownerIds: members.map((member) => member.userId) };
}

/**
 * The periodic housekeeping: expired demo workspaces (with the guest accounts that owned them),
 * files nothing points to, audit entries past their retention, and expired sessions and tokens.
 * Safe to run at any time and as often as wanted; every step is independent.
 */
export async function runMaintenance({
  prisma,
  storage,
  now = new Date(),
  auditRetentionDays = 365,
  orphanGraceMinutes = 60,
}: MaintenanceDeps): Promise<MaintenanceReport> {
  const report: MaintenanceReport = {
    expiredDemoOrganizations: 0,
    anonymousUsersRemoved: 0,
    orphanFilesSwept: 0,
    auditEntriesPurged: 0,
    expiredSessionsPurged: 0,
    expiredVerificationsPurged: 0,
  };

  // 1. Expired demos.
  const expired = await prisma.organization.findMany({
    where: { isDemo: true, demoExpiresAt: { lt: now } },
    select: { id: true },
  });
  const guestIds = new Set<string>();
  for (const { id } of expired) {
    try {
      const { deleted, ownerIds } = await deleteDemoOrganization({ prisma, storage }, id);
      if (!deleted) continue;
      report.expiredDemoOrganizations += 1;
      ownerIds.forEach((userId) => guestIds.add(userId));
    } catch (error) {
      console.error(`Could not delete the demo organization ${id}`, error);
    }
  }
  if (guestIds.size > 0) {
    // Only guests that have nowhere left to work: a guest who signed up for real is not anonymous any more.
    const { count } = await prisma.user.deleteMany({
      where: { id: { in: [...guestIds] }, isAnonymous: true, memberships: { none: {} } },
    });
    report.anonymousUsersRemoved = count;
  }

  // 2. Files that nothing points to (includes what deleted properties left behind).
  report.orphanFilesSwept = await sweepOrphanFiles(prisma, storage, {
    olderThan: new Date(now.getTime() - orphanGraceMinutes * 60_000),
  });

  // 3. Audit retention.
  report.auditEntriesPurged = await createAuditRepository(prisma).deleteOlderThan(new Date(now.getTime() - auditRetentionDays * DAY_MS));

  // 4. Expired sessions and verification tokens.
  report.expiredSessionsPurged = (await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } })).count;
  report.expiredVerificationsPurged = (await prisma.verification.deleteMany({ where: { expiresAt: { lt: now } } })).count;

  return report;
}

export interface MaintenanceJobOptions extends MaintenanceDeps {
  intervalMinutes: number;
  log?: (message: string) => void;
  /** The work of each tick; replaceable in tests. */
  run?: (deps: MaintenanceDeps) => Promise<MaintenanceReport>;
}

/**
 * Runs the maintenance now and then every `intervalMinutes`. A run that is still going when the
 * next tick arrives makes that tick a no-op, so runs never overlap. Returns a function that stops it.
 */
export function startMaintenanceJob({
  intervalMinutes,
  log = console.log,
  run = runMaintenance,
  ...deps
}: MaintenanceJobOptions): () => void {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const report = await run({ ...deps, now: new Date() });
      const worked = Object.values(report).some((count) => count > 0);
      if (worked) log(`Maintenance: ${JSON.stringify(report)}`);
    } catch (error) {
      console.error("Maintenance run failed", error);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMinutes * 60_000);
  // Do not keep the process alive just for the job.
  timer.unref();
  return () => clearInterval(timer);
}
