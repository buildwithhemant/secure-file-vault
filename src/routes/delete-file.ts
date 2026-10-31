import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { VaultContext } from '../lib/context.js';
import { fail, getClaims, json, pathParam, requestMeta, type ApiEvent, type ApiResult } from '../lib/http.js';

/**
 * DELETE /files/{fileId}
 * The bucket is versioned, so this writes a delete marker: the bytes stay
 * recoverable until the noncurrent-version lifecycle rule expires them.
 */
export async function deleteFile(event: ApiEvent, ctx: VaultContext): Promise<ApiResult> {
  const { sub } = getClaims(event);
  const fileId = pathParam(event, 'fileId');
  const file = await ctx.store.getFile(sub, fileId);
  if (!file || file.status === 'deleted') return fail(404, 'file not found');

  await ctx.s3.send(new DeleteObjectCommand({ Bucket: ctx.cfg.bucketName, Key: file.s3Key }));
  const deletedAt = new Date().toISOString();
  await ctx.store.updateFile(sub, fileId, { status: 'deleted', deletedAt });
  await ctx.store.addAudit(sub, { action: 'delete', fileId, ...requestMeta(event) });

  return json(200, { fileId, status: 'deleted', deletedAt });
}
