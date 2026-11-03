import type { AuditAction, AuditEntityType } from "../../generated/prisma/enums.js";
import type { AuditRepository } from "./audit.repository.js";

export interface AuditEvent {
  action: AuditAction;
  entityType?: AuditEntityType | null;
  entityId?: string | null;
  details?: string | null;
  /** `null` marks a platform-level event. */
  organizationId?: string | null;
  actor?: { id: string; name: string; email: string; role: string | null } | null;
  /** Set when a platform admin acted through impersonation. */
  impersonatedById?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** What the rest of the app depends on to leave a trace. */
export interface AuditRecorder {
  record(event: AuditEvent): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clip = (value: string | null | undefined, max: number) => (value ? value.slice(0, max) : null);

/**
 * Writes the trail. A failure to write is logged and swallowed: losing an audit line must never
 * break the action that was being audited.
 */
export function createAuditRecorder(repository: AuditRepository): AuditRecorder {
  return {
    async record(event) {
      try {
        await repository.create({
          organizationId: event.organizationId ?? null,
          actorUserId: event.actor?.id ?? null,
          actorName: clip(event.actor?.name, 255),
          actorEmail: clip(event.actor?.email, 320),
          actorRole: clip(event.actor?.role, 100),
          impersonatedById: event.impersonatedById ?? null,
          action: event.action,
          entityType: event.entityType ?? null,
          // The column is a uuid: anything else is dropped rather than failing the write.
          entityId: event.entityId && UUID.test(event.entityId) ? event.entityId : null,
          details: event.details ?? null,
          ipAddress: clip(event.ipAddress, 45),
          userAgent: clip(event.userAgent, 500),
        });
      } catch (error) {
        console.error("Could not write the audit log", error);
      }
    },
  };
}

/** The caller's address as reported by the proxy in front of the API. */
export function clientIp(headers: { get(name: string): string | null }): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || null;
}
