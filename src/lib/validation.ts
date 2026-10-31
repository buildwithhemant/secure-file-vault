import type { VaultConfig } from './config.js';

export interface UploadRequest {
  name: string;
  contentType: string;
  size: number;
}

/** Keeps only a display name: no path separators, no control characters, bounded length. */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 255);
  return cleaned || 'file';
}

export function isContentTypeAllowed(contentType: string, allowed: string[]): boolean {
  const ct = contentType.toLowerCase();
  return allowed.some((rule) => {
    if (rule === '*' || rule === '*/*') return true;
    if (rule.endsWith('/*')) return ct.startsWith(rule.slice(0, -1));
    return ct === rule;
  });
}

export type ValidationResult = { ok: true; value: UploadRequest } | { ok: false; error: string };

export function validateUploadRequest(body: unknown, cfg: VaultConfig): ValidationResult {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be a JSON object' };
  const b = body as Record<string, unknown>;

  if (typeof b.name !== 'string' || !b.name.trim()) return { ok: false, error: 'name is required' };
  const name = sanitizeFilename(b.name);

  if (typeof b.contentType !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(b.contentType)) {
    return { ok: false, error: 'contentType must look like type/subtype' };
  }
  const contentType = b.contentType.toLowerCase();
  if (!isContentTypeAllowed(contentType, cfg.allowedContentTypes)) {
    return { ok: false, error: `contentType ${contentType} is not allowed` };
  }

  if (typeof b.size !== 'number' || !Number.isInteger(b.size) || b.size <= 0) {
    return { ok: false, error: 'size must be a positive integer (bytes)' };
  }
  if (b.size > cfg.maxFileSizeBytes) {
    return { ok: false, error: `size exceeds the limit of ${cfg.maxFileSizeBytes} bytes` };
  }

  return { ok: true, value: { name, contentType, size: b.size } };
}

/** RFC 6266 header so browsers save the file under its original name, including non-ASCII names. */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
