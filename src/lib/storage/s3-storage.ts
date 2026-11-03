import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { type StorageProvider, assertSafeKey } from "./storage.js";

/** The slice of the AWS client this driver needs, so tests can pass a fake. */
export interface S3Like {
  send(command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand): Promise<unknown>;
}

export interface S3StorageOptions {
  bucket: string;
  client: S3Like;
}

interface GetObjectResult {
  Body?: { transformToByteArray(): Promise<Uint8Array> };
  ContentType?: string;
  ContentLength?: number;
}

function isMissing(error: unknown): boolean {
  const failure = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return failure.name === "NoSuchKey" || failure.$metadata?.httpStatusCode === 404;
}

/** Production driver: any S3-compatible bucket (R2, B2, MinIO, AWS...). */
export function createS3Storage({ bucket, client }: S3StorageOptions): StorageProvider {
  return {
    async put(key, body, { contentType }) {
      assertSafeKey(key);
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },

    async get(key) {
      assertSafeKey(key);
      try {
        const result = (await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))) as GetObjectResult;
        if (!result.Body) return null;
        const body = Buffer.from(await result.Body.transformToByteArray());
        return { body, contentType: result.ContentType ?? null, sizeBytes: body.length };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async delete(key) {
      assertSafeKey(key);
      // S3 answers success for a key that is not there, which is the idempotence we want.
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

export interface S3ConnectionOptions {
  endpoint?: string | undefined;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export function createS3Client({ endpoint, region, accessKeyId, secretAccessKey, forcePathStyle }: S3ConnectionOptions): S3Client {
  return new S3Client({
    region,
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle,
    credentials: { accessKeyId, secretAccessKey },
  });
}
