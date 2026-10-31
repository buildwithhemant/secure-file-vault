export interface VaultConfig {
  tableName: string;
  bucketName: string;
  kmsKeyArn: string;
  maxFileSizeBytes: number;
  /** lower-cased entries such as `image/*`, `application/pdf`; `*` allows everything */
  allowedContentTypes: string[];
  uploadUrlTtlSeconds: number;
  downloadUrlTtlSeconds: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const v = env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer (got "${v}")`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): VaultConfig {
  return {
    tableName: required(env, 'TABLE_NAME'),
    bucketName: required(env, 'BUCKET_NAME'),
    kmsKeyArn: required(env, 'KMS_KEY_ARN'),
    maxFileSizeBytes: int(env, 'MAX_FILE_SIZE_BYTES', 104_857_600),
    allowedContentTypes: (env.ALLOWED_CONTENT_TYPES ?? '*')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    uploadUrlTtlSeconds: int(env, 'UPLOAD_URL_TTL_SECONDS', 300),
    downloadUrlTtlSeconds: int(env, 'DOWNLOAD_URL_TTL_SECONDS', 60),
  };
}
