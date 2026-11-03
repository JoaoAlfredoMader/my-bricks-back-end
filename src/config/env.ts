import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must have at least 32 characters"),
    BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
    FRONTEND_URL: z.string().url().default("http://localhost:5173"),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    DEMO_TTL_HOURS: z.coerce.number().int().positive().default(24),

    /** Where uploaded files live: a folder on disk (development) or an S3-compatible bucket. */
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_DIR: z.string().min(1).default(".data/storage"),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().min(1).default("auto"),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    /** Most S3-compatible services (R2, MinIO, B2...) want path-style addressing. */
    S3_FORCE_PATH_STYLE: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    /** Largest accepted upload, in megabytes. */
    MAX_UPLOAD_MB: z.coerce.number().positive().max(100).default(15),
  })
  .superRefine((env, context) => {
    if (env.STORAGE_DRIVER !== "s3") return;
    for (const key of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
      if (!env[key]) context.addIssue({ code: "custom", path: [key], message: `${key} is required when STORAGE_DRIVER=s3` });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment variables: ${details}`);
  }
  return parsed.data;
}
