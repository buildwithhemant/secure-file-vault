import { toPublicFile, type VaultContext } from '../lib/context.js';
import { getClaims, json, type ApiEvent, type ApiResult } from '../lib/http.js';

/** GET /files — only the caller's own files can ever come back; the partition key is the caller's sub. */
export async function listFiles(event: ApiEvent, ctx: VaultContext): Promise<ApiResult> {
  const { sub } = getClaims(event);
  const files = await ctx.store.listFiles(sub);
  return json(200, { files: files.filter((f) => f.status !== 'deleted').map(toPublicFile) });
}
