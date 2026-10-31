import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handler } from '../src/handlers/api.js';
import type { FileRecord } from '../src/lib/store.js';
import { makeEvent, parse, SUB } from './helpers.js';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(
    async (_client: unknown, command: { input: { Key: string } }) => `https://s3.example.test/${command.input.Key}?signed=1`,
  ),
}));

const ddb = mockClient(DynamoDBDocumentClient);
const s3 = mockClient(S3Client);

const ready: FileRecord = {
  pk: `USER#${SUB}`,
  sk: 'FILE#f1',
  fileId: 'f1',
  owner: SUB,
  name: 'Résumé 2026.pdf',
  contentType: 'application/pdf',
  size: 500,
  status: 'ready',
  s3Key: `users/${SUB}/f1`,
  createdAt: '2026-11-01T00:00:00.000Z',
  readyAt: '2026-11-01T00:01:00.000Z',
};

beforeEach(() => {
  ddb.reset();
  s3.reset();
  ddb.on(PutCommand).resolves({});
  ddb.on(UpdateCommand).resolves({});
  vi.mocked(getSignedUrl).mockClear();
});

describe('GET /files/{fileId}/download', () => {
  it('returns a short-lived presigned GET with the original filename and writes an audit entry', async () => {
    ddb.on(GetCommand).resolves({ Item: ready });
    const res = await handler(makeEvent({ routeKey: 'GET /files/{fileId}/download', pathParameters: { fileId: 'f1' } }));
    expect(res.statusCode).toBe(200);
    expect(parse(res).download).toEqual({
      method: 'GET',
      url: `https://s3.example.test/users/${SUB}/f1?signed=1`,
      expiresInSeconds: 60,
    });

    const command = vi.mocked(getSignedUrl).mock.calls[0]?.[1] as GetObjectCommand;
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toMatchObject({ Bucket: 'vault-data-test', Key: `users/${SUB}/f1`, ResponseContentType: 'application/pdf' });
    expect(command.input.ResponseContentDisposition).toBe(
      `attachment; filename="R_sum_ 2026.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%202026.pdf`,
    );
    expect(vi.mocked(getSignedUrl).mock.calls[0]?.[2]).toEqual({ expiresIn: 60 });

    // lookup is scoped to the caller's partition: another user's id simply does not resolve
    expect(ddb.commandCalls(GetCommand)[0]?.args[0].input.Key).toEqual({ pk: `USER#${SUB}`, sk: 'FILE#f1' });
    expect(ddb.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({ action: 'download_url', fileId: 'f1', ip: '203.0.113.9' });
  });

  it('refuses files that are missing, pending, rejected or deleted', async () => {
    const call = () => handler(makeEvent({ routeKey: 'GET /files/{fileId}/download', pathParameters: { fileId: 'f1' } }));
    ddb.on(GetCommand).resolves({});
    expect((await call()).statusCode).toBe(404);
    ddb.on(GetCommand).resolves({ Item: { ...ready, status: 'pending' } });
    expect((await call()).statusCode).toBe(409);
    ddb.on(GetCommand).resolves({ Item: { ...ready, status: 'rejected', rejectedReason: 'size mismatch' } });
    expect(parse(await call()).error).toMatch(/rejected: size mismatch/);
    ddb.on(GetCommand).resolves({ Item: { ...ready, status: 'deleted' } });
    expect((await call()).statusCode).toBe(404);
    expect(vi.mocked(getSignedUrl)).not.toHaveBeenCalled();
  });

  it('rejects malformed ids before touching storage', async () => {
    const res = await handler(makeEvent({ routeKey: 'GET /files/{fileId}/download', pathParameters: { fileId: '../x' } }));
    expect(res.statusCode).toBe(400);
    expect(ddb.commandCalls(GetCommand)).toHaveLength(0);
  });
});

describe('GET /files and GET /files/{fileId}', () => {
  it("lists the caller's files without deleted ones and without internal fields", async () => {
    ddb.on(QueryCommand).resolves({ Items: [ready, { ...ready, fileId: 'f2', sk: 'FILE#f2', status: 'deleted' }] });
    const res = await handler(makeEvent({ routeKey: 'GET /files' }));
    const { files } = parse(res);
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({
      fileId: 'f1',
      name: 'Résumé 2026.pdf',
      contentType: 'application/pdf',
      size: 500,
      status: 'ready',
      createdAt: ready.createdAt,
      readyAt: ready.readyAt,
    });
    expect(files[0]).not.toHaveProperty('s3Key');
    const q = ddb.commandCalls(QueryCommand)[0]?.args[0].input;
    expect(q?.ExpressionAttributeValues).toEqual({ ':pk': `USER#${SUB}`, ':prefix': 'FILE#' });
  });

  it("returns one file's metadata", async () => {
    ddb.on(GetCommand).resolves({ Item: ready });
    const res = await handler(makeEvent({ routeKey: 'GET /files/{fileId}', pathParameters: { fileId: 'f1' } }));
    expect(parse(res)).toMatchObject({ fileId: 'f1', status: 'ready' });
  });
});

describe('DELETE /files/{fileId}', () => {
  it('deletes the object, marks the record and audits it', async () => {
    ddb.on(GetCommand).resolves({ Item: ready });
    s3.on(DeleteObjectCommand).resolves({});
    const res = await handler(makeEvent({ routeKey: 'DELETE /files/{fileId}', pathParameters: { fileId: 'f1' } }));
    expect(res.statusCode).toBe(200);
    expect(s3.commandCalls(DeleteObjectCommand)[0]?.args[0].input).toEqual({ Bucket: 'vault-data-test', Key: `users/${SUB}/f1` });
    const update = ddb.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(update?.ExpressionAttributeValues).toMatchObject({ ':v0': 'deleted' });
    expect(update?.ConditionExpression).toBe('attribute_exists(pk)');
    expect(ddb.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({ action: 'delete', fileId: 'f1' });
  });

  it('404s for unknown or already deleted files and touches nothing', async () => {
    ddb.on(GetCommand).resolves({ Item: { ...ready, status: 'deleted' } });
    const res = await handler(makeEvent({ routeKey: 'DELETE /files/{fileId}', pathParameters: { fileId: 'f1' } }));
    expect(res.statusCode).toBe(404);
    expect(s3.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });
});

describe('GET /audit and routing', () => {
  it('returns the audit trail newest first', async () => {
    ddb.on(QueryCommand).resolves({
      Items: [{ pk: `USER#${SUB}`, sk: 'AUDIT#2026', at: '2026-11-01T00:00:00Z', action: 'download_url', fileId: 'f1', ip: '1.2.3.4' }],
    });
    const res = await handler(makeEvent({ routeKey: 'GET /audit' }));
    expect(parse(res).audit).toEqual([{ at: '2026-11-01T00:00:00Z', action: 'download_url', fileId: 'f1', ip: '1.2.3.4' }]);
    expect(ddb.commandCalls(QueryCommand)[0]?.args[0].input.ScanIndexForward).toBe(false);
  });

  it('404s unknown routes and 500s without leaking errors', async () => {
    expect((await handler(makeEvent({ routeKey: 'GET /nope' }))).statusCode).toBe(404);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    ddb.on(QueryCommand).rejects(new Error('dynamo down'));
    const res = await handler(makeEvent({ routeKey: 'GET /files' }));
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('dynamo down');
    expect(quiet).toHaveBeenCalledOnce();
    quiet.mockRestore();
  });
});
