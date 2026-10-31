import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { VaultContext } from '../lib/context.js';
import { fail, getClaims, json, pathParam, requestMeta, type ApiEvent, type ApiResult } from '../lib/http.js';
import { contentDisposition } from '../lib/validation.js';

/**
 * GET /files/{fileId}/download
 * Short-lived presigned GET. Every issued link is written to the audit trail
 * with the caller's IP and user agent.
 */
export async function getDownload(event: ApiEvent, ctx: VaultContext): Promise<ApiResult> {
  const { sub } = getClaims(event);
  const fileId = pathParam(event, 'fileId');
  const file = await ctx.store.getFile(sub, fileId);
  if (!file || file.status === 'deleted') return fail(404, 'file not found');
  if (file.status === 'pending') return fail(409, 'upload has not completed yet');
  if (file.status === 'rejected') return fail(409, `upload was rejected: ${file.rejectedReason ?? 'policy violation'}`);

  const command = new GetObjectCommand({
    Bucket: ctx.cfg.bucketName,
    Key: file.s3Key,
    ResponseContentDisposition: contentDisposition(file.name),
    ResponseContentType: file.contentType,
  });
  const url = await getSignedUrl(ctx.s3, command, { expiresIn: ctx.cfg.downloadUrlTtlSeconds });

  await ctx.store.addAudit(sub, { action: 'download_url', fileId, ...requestMeta(event) });

  return json(200, {
    fileId,
    name: file.name,
    contentType: file.contentType,
    size: file.size,
    download: { method: 'GET', url, expiresInSeconds: ctx.cfg.downloadUrlTtlSeconds },
  });
}
