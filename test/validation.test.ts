import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/lib/config.js';
import { objectKey, parseObjectKey } from '../src/lib/store.js';
import { contentDisposition, isContentTypeAllowed, sanitizeFilename, validateUploadRequest } from '../src/lib/validation.js';

describe('sanitizeFilename', () => {
  it('removes path separators and control characters, bounds the length', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(sanitizeFilename('C:\\Users\\me\\x.txt')).toBe('C:_Users_me_x.txt');
    expect(sanitizeFilename('a\u0000b\nc.txt')).toBe('abc.txt');
    expect(sanitizeFilename('   ')).toBe('file');
    expect(sanitizeFilename('x'.repeat(300))).toHaveLength(255);
  });
});

describe('isContentTypeAllowed', () => {
  it('supports exact, wildcard subtype and allow-all rules', () => {
    expect(isContentTypeAllowed('image/png', ['image/*'])).toBe(true);
    expect(isContentTypeAllowed('image/png', ['application/pdf'])).toBe(false);
    expect(isContentTypeAllowed('Application/PDF', ['application/pdf'])).toBe(true);
    expect(isContentTypeAllowed('video/mp4', ['*'])).toBe(true);
    expect(isContentTypeAllowed('imagex/png', ['image/*'])).toBe(false);
  });
});

describe('validateUploadRequest', () => {
  const cfg = loadConfig({
    TABLE_NAME: 't',
    BUCKET_NAME: 'b',
    KMS_KEY_ARN: 'k',
    MAX_FILE_SIZE_BYTES: '100',
    ALLOWED_CONTENT_TYPES: 'text/plain',
  });
  it('normalises a valid request', () => {
    expect(validateUploadRequest({ name: ' notes.txt ', contentType: 'Text/Plain', size: 100 }, cfg)).toEqual({
      ok: true,
      value: { name: 'notes.txt', contentType: 'text/plain', size: 100 },
    });
  });
  it('rejects non-objects', () => {
    expect(validateUploadRequest('x', cfg)).toMatchObject({ ok: false });
    expect(validateUploadRequest(null, cfg)).toMatchObject({ ok: false });
  });
});

describe('contentDisposition', () => {
  it('provides an ASCII fallback and an RFC 5987 encoded name', () => {
    expect(contentDisposition('plain.txt')).toBe(`attachment; filename="plain.txt"; filename*=UTF-8''plain.txt`);
    expect(contentDisposition('q"uote.txt')).toBe(`attachment; filename="q_uote.txt"; filename*=UTF-8''q%22uote.txt`);
  });
});

describe('object keys', () => {
  it('round-trips and rejects anything outside users/<owner>/<id>', () => {
    expect(parseObjectKey(objectKey('u1', 'f1'))).toEqual({ owner: 'u1', fileId: 'f1' });
    expect(parseObjectKey('users/u1/f1/extra')).toBeUndefined();
    expect(parseObjectKey('other/u1/f1')).toBeUndefined();
  });
});

describe('loadConfig', () => {
  it('requires the core variables and parses the rest', () => {
    expect(() => loadConfig({})).toThrow(/TABLE_NAME is required/);
    const cfg = loadConfig({ TABLE_NAME: 't', BUCKET_NAME: 'b', KMS_KEY_ARN: 'k' });
    expect(cfg).toMatchObject({
      maxFileSizeBytes: 104_857_600,
      allowedContentTypes: ['*'],
      uploadUrlTtlSeconds: 300,
      downloadUrlTtlSeconds: 60,
    });
    expect(() => loadConfig({ TABLE_NAME: 't', BUCKET_NAME: 'b', KMS_KEY_ARN: 'k', MAX_FILE_SIZE_BYTES: '-1' })).toThrow(/positive integer/);
  });
});
