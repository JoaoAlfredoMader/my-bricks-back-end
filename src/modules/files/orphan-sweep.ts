import type { PrismaClient } from "../../lib/prisma.js";
import type { StorageProvider } from "../../lib/storage/storage.js";

export interface OrphanSweepOptions {
  /** Only files created before this moment are considered, so an upload in flight is never swept. */
  olderThan: Date;
  /** Safety valve per run. */
  batchSize?: number;
}

/**
 * Removes files that nothing points to any more: no photo, no document, no contract PDF and no
 * feedback attachment. They appear when a property is deleted (its photo rows cascade, the file
 * rows do not) or when a deletion could not reach the storage. The object goes first and the row
 * only after it, so a failure leaves the row for the next run instead of losing track of the object.
 * Returns how many files were swept.
 */
export async function sweepOrphanFiles(
  prisma: PrismaClient,
  storage: StorageProvider,
  { olderThan, batchSize = 500 }: OrphanSweepOptions,
): Promise<number> {
  const orphans = await prisma.storedFile.findMany({
    where: {
      createdAt: { lt: olderThan },
      photos: { none: {} },
      documents: { none: {} },
      contractPdfs: { none: {} },
      feedbackAttachments: { none: {} },
    },
    select: { id: true, storageKey: true },
    take: batchSize,
  });

  let swept = 0;
  for (const file of orphans) {
    try {
      await storage.delete(file.storageKey);
      await prisma.storedFile.delete({ where: { id: file.id } });
      swept += 1;
    } catch (error) {
      console.error(`Could not sweep the file ${file.id}`, error);
    }
  }
  return swept;
}
