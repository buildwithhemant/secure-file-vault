import { DeleteObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import type { S3Event } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handler } from '../src/handlers/finalize.js';
import type { FileRecord } from '../src/lib/store.js';
import { SUB } from './helpers.js';

const ddb = mockClient(DynamoDBDocumentClient);
const s3 = mockClient(S3Client);
const KEY_ARN = process.env.KMS_KEY_ARN as string;

const pending: FileRecord = {
  pk: `USER#${SUB}`,
  sk: 'FILE#f1',
  fileId: 'f1',
  owner: SUB,
  name: 'a.pdf',
  contentType: 'application/pdf',
  size: 500,
  status: 'pending',
  s3Key: `users/${SUB}/f1`,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const event = (key = `users/${SUB}/f1`): S3Event =>
  ({
    Records: [{ s3: { bucket: { name: 'vault-data-test' }, object: { key: encodeURIComponent(key).replace(/%2F/g, '/') } } }],
  }) as unknown as S3Event;

const goodHead = {
  ServerSideEncryption: 'aws:kms' as const,
  SSEKMSKeyId: KEY_ARN,
  ContentLength: 500,
  ContentType: 'application/pdf',
  ETag: '"abc"',
  VersionId: 'v1',
};

beforeEach(() => {
  ddb.reset();
  s3.reset();
  ddb.on(PutCommand).resolves({});
  ddb.on(UpdateCommand).resolves({});
  s3.on(DeleteObjectCommand).resolves({});
});

const updateValues = () => ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input.ExpressionAttributeValues);

describe('finalize (S3 ObjectCreated)', () => {
  it('marks a compliant upload ready with etag and version', async () => {
    ddb.on(GetCommand).resolves({ Item: pending });
    s3.on(HeadObjectCommand).resolves(goodHead);
    await handler(event());
    expect(updateValues()[0]).toMatchObject({ ':v0': 'ready', ':v2': '"abc"', ':v3': 'v1' });
    expect(s3.commandCalls(DeleteObjectCommand)).toHaveLength(0);
    expect(ddb.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({ action: 'upload_completed', fileId: 'f1' });
  });

  it('accepts the key reported by a different ARN form with the same key id', async () => {
    ddb.on(GetCommand).resolves({ Item: pending });
    s3.on(HeadObjectCommand).resolves({ ...goodHead, SSEKMSKeyId: `arn:aws:kms:ap-south-1:123456789012:key/${KEY_ARN.split('/').pop()}` });
    await handler(event());
    expect(updateValues()[0]).toMatchObject({ ':v0': 'ready' });
  });

  it.each([
    ['not encrypted with KMS', { ...goodHead, ServerSideEncryption: 'AES256', SSEKMSKeyId: undefined }, /not encrypted with SSE-KMS/],
    ['wrong key', { ...goodHead, SSEKMSKeyId: 'arn:aws:kms:ap-south-1:123456789012:key/other' }, /wrong KMS key/],
    ['size mismatch', { ...goodHead, ContentLength: 501 }, /size mismatch/],
    ['content type mismatch', { ...goodHead, ContentType: 'text/html' }, /content type mismatch/],
  ])('deletes and rejects an object that is %s', async (_label, head, reason) => {
    ddb.on(GetCommand).resolves({ Item: pending });
    s3.on(HeadObjectCommand).resolves(head as never);
    await handler(event());
    expect(s3.commandCalls(DeleteObjectCommand)[0]?.args[0].input).toEqual({ Bucket: 'vault-data-test', Key: `users/${SUB}/f1` });
    const values = updateValues()[0] as Record<string, string>;
    expect(values[':v0']).toBe('rejected');
    expect(values[':v1']).toMatch(reason);
    expect(ddb.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({ action: 'upload_rejected', fileId: 'f1' });
  });

  it('deletes objects that were never registered through the API', async () => {
    ddb.on(GetCommand).resolves({});
    await handler(event(`users/${SUB}/unknown`));
    expect(s3.commandCalls(DeleteObjectCommand)[0]?.args[0].input.Key).toBe(`users/${SUB}/unknown`);
    expect(s3.commandCalls(HeadObjectCommand)).toHaveLength(0);
  });

  it('is idempotent for already processed files and ignores keys outside users/', async () => {
    ddb.on(GetCommand).resolves({ Item: { ...pending, status: 'ready' } });
    await handler(event());
    expect(s3.commandCalls(HeadObjectCommand)).toHaveLength(0);
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
    await handler(event('somewhere/else.txt'));
    expect(ddb.commandCalls(GetCommand)).toHaveLength(1);
  });

  it('propagates storage errors so Lambda retries the event', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    ddb.on(GetCommand).rejects(new Error('throttled'));
    await expect(handler(event())).rejects.toThrow('throttled');
    expect(quiet).toHaveBeenCalledOnce();
    quiet.mockRestore();
  });
});
