import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handler } from '../src/handlers/api.js';
import { makeEvent, parse, SUB } from './helpers.js';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(
    async (_client: unknown, command: { input: { Key: string } }) => `https://s3.example.test/${command.input.Key}?signed=1`,
  ),
}));

const ddb = mockClient(DynamoDBDocumentClient);
mockClient(S3Client);

beforeEach(() => {
  ddb.reset();
  ddb.on(PutCommand).resolves({});
  vi.mocked(getSignedUrl).mockClear();
});

describe('POST /files', () => {
  it('registers the file and returns a presigned PUT that forces KMS encryption', async () => {
    const res = await handler(
      makeEvent({ routeKey: 'POST /files', body: { name: 'invoice.pdf', contentType: 'application/pdf', size: 1234 } }),
    );
    expect(res.statusCode).toBe(201);
    const body = parse(res);
    expect(body.fileId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.upload.url).toBe(`https://s3.example.test/users/${SUB}/${body.fileId}?signed=1`);
    expect(body.upload.headers).toEqual({
      'Content-Type': 'application/pdf',
      'x-amz-server-side-encryption': 'aws:kms',
      'x-amz-server-side-encryption-aws-kms-key-id': process.env.KMS_KEY_ARN,
    });
    expect(body.upload.expiresInSeconds).toBe(300);

    // the presigned command pins key, type, size and encryption
    const command = vi.mocked(getSignedUrl).mock.calls[0]?.[1] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'vault-data-test',
      Key: `users/${SUB}/${body.fileId}`,
      ContentType: 'application/pdf',
      ContentLength: 1234,
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: process.env.KMS_KEY_ARN,
    });
    expect(vi.mocked(getSignedUrl).mock.calls[0]?.[2]).toEqual({ expiresIn: 300 });

    // metadata row + audit row, both under the caller's partition
    const puts = ddb.commandCalls(PutCommand).map((c) => c.args[0].input);
    expect(puts[0]).toMatchObject({
      TableName: 'vault-files-test',
      ConditionExpression: 'attribute_not_exists(pk)',
      Item: { pk: `USER#${SUB}`, sk: `FILE#${body.fileId}`, status: 'pending', owner: SUB, size: 1234, name: 'invoice.pdf' },
    });
    expect(puts[1]?.Item).toMatchObject({
      pk: `USER#${SUB}`,
      action: 'upload_url',
      fileId: body.fileId,
      ip: '203.0.113.9',
      userAgent: 'vitest',
    });
    expect(String(puts[1]?.Item?.sk)).toMatch(/^AUDIT#/);
  });

  it('sanitises the display name but never uses it in the object key', async () => {
    const res = await handler(
      makeEvent({ routeKey: 'POST /files', body: { name: '../../etc/passwd', contentType: 'text/plain', size: 10 } }),
    );
    const body = parse(res);
    expect(body.name).toBe('.._.._etc_passwd');
    expect(body.upload.url).toContain(`/users/${SUB}/${body.fileId}`);
  });

  it.each([
    [{ name: 'a.bin', contentType: 'application/octet-stream', size: 10 }, /not allowed/],
    [{ name: 'a.pdf', contentType: 'application/pdf', size: 1_048_577 }, /exceeds the limit/],
    [{ name: 'a.pdf', contentType: 'application/pdf', size: 0 }, /positive integer/],
    [{ name: '', contentType: 'application/pdf', size: 1 }, /name is required/],
    [{ name: 'a', contentType: 'pdf', size: 1 }, /type\/subtype/],
  ])('rejects invalid request %j', async (body, message) => {
    const res = await handler(makeEvent({ routeKey: 'POST /files', body }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toMatch(message);
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('rejects malformed JSON and unauthenticated calls', async () => {
    const bad = makeEvent({ routeKey: 'POST /files' });
    bad.body = '{not json';
    expect((await handler(bad)).statusCode).toBe(400);
    const anonymous = makeEvent({
      routeKey: 'POST /files',
      body: { name: 'a.pdf', contentType: 'application/pdf', size: 1 },
      sub: null,
    });
    expect((await handler(anonymous)).statusCode).toBe(401);
  });

  it('allows wildcard content types from the allow-list', async () => {
    const res = await handler(makeEvent({ routeKey: 'POST /files', body: { name: 'photo.png', contentType: 'image/png', size: 99 } }));
    expect(res.statusCode).toBe(201);
  });
});
