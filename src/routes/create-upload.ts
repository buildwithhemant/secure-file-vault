import { randomUUID } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { VaultContext } from '../lib/context.js';
import { getClaims, json, parseJsonBody, requestMeta, type ApiEvent, type ApiResult } from '../lib/http.js';
import { fileKey, objectKey } from '../lib/store.js';
import { validateUploadRequest } from '../lib/validation.js';

/**
 * POST /files
 * Registers the file and hands back a short-lived presigned PUT. The URL only
 * works for this exact key, content type, size and KMS key, so a client can't
 * reuse it to write somewhere else or skip encryption.
 */
export async function createUpload(event: ApiEvent, ctx: VaultContext): Promise<ApiResult> {
  const { sub } = getClaims(event);
  const result = validateUploadRequest(parseJsonBody(event), ctx.cfg);
  if (!result.ok) return json(400, { error: result.error });

  const { name, contentType, size } = result.value;
  const fileId = randomUUID();
  const s3Key = objectKey(sub, fileId);
  const createdAt = new Date().toISOString();

  await ctx.store.createFile({
    ...fileKey(sub, fileId),
    fileId,
    owner: sub,
    name,
    contentType,
    size,
    status: 'pending',
    s3Key,
    createdAt,
  });

  const command = new PutObjectCommand({
    Bucket: ctx.cfg.bucketName,
    Key: s3Key,
    ContentType: contentType,
    ContentLength: size,
    ServerSideEncryption: 'aws:kms',
    SSEKMSKeyId: ctx.cfg.kmsKeyArn,
  });
  const uploadUrl = await getSignedUrl(ctx.s3, command, { expiresIn: ctx.cfg.uploadUrlTtlSeconds });

  await ctx.store.addAudit(sub, { action: 'upload_url', fileId, ...requestMeta(event) });

  return json(201, {
    fileId,
    name,
    contentType,
    size,
    status: 'pending',
    upload: {
      method: 'PUT',
      url: uploadUrl,
      headers: {
        'Content-Type': contentType,
        'x-amz-server-side-encryption': 'aws:kms',
        'x-amz-server-side-encryption-aws-kms-key-id': ctx.cfg.kmsKeyArn,
      },
      expiresInSeconds: ctx.cfg.uploadUrlTtlSeconds,
    },
  });
}
