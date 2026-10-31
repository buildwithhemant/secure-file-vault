import { DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { S3Event } from 'aws-lambda';
import { getContext, type VaultContext } from '../lib/context.js';
import { parseObjectKey } from '../lib/store.js';

/**
 * Triggered by S3 ObjectCreated events. The presigned URL already constrains
 * what can be written, but this is the second line of defence: the object is
 * checked against the metadata registered by the API, and anything that
 * doesn't match (or was never registered) is deleted rather than served.
 */
export const handler = async (event: S3Event): Promise<void> => {
  const ctx = getContext();
  for (const record of event.Records ?? []) {
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    try {
      await finalizeObject(ctx, record.s3.bucket.name, key);
    } catch (err) {
      console.error('finalize failed', { key }, err);
      throw err; // let Lambda retry / dead-letter it
    }
  }
};

function keyMatches(reported: string | undefined, expectedArn: string): boolean {
  if (!reported) return false;
  if (reported === expectedArn) return true;
  const expectedId = expectedArn.split('/').pop();
  return reported.endsWith(`/${expectedId}`);
}

export async function finalizeObject(ctx: VaultContext, bucket: string, key: string): Promise<string> {
  const parsed = parseObjectKey(key);
  if (!parsed) {
    console.warn('ignoring object outside users/ prefix', { key });
    return 'ignored';
  }
  const { owner, fileId } = parsed;
  const file = await ctx.store.getFile(owner, fileId);

  if (!file) {
    // Nobody registered this upload through the API: it cannot stay.
    await ctx.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    console.warn('deleted unregistered object', { key });
    return 'orphan_deleted';
  }
  if (file.status !== 'pending') return 'already_processed';

  const head = await ctx.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  const problems: string[] = [];
  if (head.ServerSideEncryption !== 'aws:kms') problems.push('object is not encrypted with SSE-KMS');
  if (!keyMatches(head.SSEKMSKeyId, ctx.cfg.kmsKeyArn)) problems.push('object is encrypted with the wrong KMS key');
  if (head.ContentLength !== file.size) problems.push(`size mismatch (expected ${file.size}, got ${head.ContentLength})`);
  if ((head.ContentType ?? '').toLowerCase() !== file.contentType) {
    problems.push(`content type mismatch (expected ${file.contentType}, got ${head.ContentType})`);
  }

  if (problems.length > 0) {
    const reason = problems.join('; ');
    await ctx.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    await ctx.store.updateFile(owner, fileId, { status: 'rejected', rejectedReason: reason });
    await ctx.store.addAudit(owner, { action: 'upload_rejected', fileId, detail: reason });
    console.warn('rejected upload', { key, reason });
    return 'rejected';
  }

  await ctx.store.updateFile(owner, fileId, {
    status: 'ready',
    readyAt: new Date().toISOString(),
    etag: head.ETag,
    versionId: head.VersionId,
  });
  await ctx.store.addAudit(owner, { action: 'upload_completed', fileId });
  return 'ready';
}
