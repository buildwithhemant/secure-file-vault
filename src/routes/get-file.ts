import { toPublicFile, type VaultContext } from '../lib/context.js';
import { fail, getClaims, json, pathParam, type ApiEvent, type ApiResult } from '../lib/http.js';

/** GET /files/{fileId} */
export async function getFile(event: ApiEvent, ctx: VaultContext): Promise<ApiResult> {
  const { sub } = getClaims(event);
  const fileId = pathParam(event, 'fileId');
  const file = await ctx.store.getFile(sub, fileId);
  if (!file || file.status === 'deleted') return fail(404, 'file not found');
  return json(200, toPublicFile(file));
}
