import type { Env } from "../../config/env.js";
import { createLocalStorage } from "./local-storage.js";
import { createS3Client, createS3Storage } from "./s3-storage.js";
import type { StorageProvider } from "./storage.js";

export type { StorageProvider } from "./storage.js";

/** Picks the driver from the environment. The env schema already guarantees the S3 settings are there. */
export function createStorage(env: Env): StorageProvider {
  if (env.STORAGE_DRIVER === "s3") {
    return createS3Storage({
      bucket: env.S3_BUCKET!,
      client: createS3Client({
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      }),
    });
  }
  return createLocalStorage(env.STORAGE_DIR);
}
