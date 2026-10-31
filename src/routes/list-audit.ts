import type { VaultContext } from '../lib/context.js';
import { getClaims, json, type ApiEvent, type ApiResult } from '../lib/http.js';

/** GET /audit — the caller's own access history, newest first. */
export async function listAudit(event: ApiEvent, ctx: VaultContext): Promise<ApiResult> {
  const { sub } = getClaims(event);
  const entries = await ctx.store.listAudit(sub);
  return json(200, {
    audit: entries.map((e) => ({
      at: e.at,
      action: e.action,
      fileId: e.fileId,
      ip: e.ip,
      userAgent: e.userAgent,
      detail: e.detail,
    })),
  });
}
