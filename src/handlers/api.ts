import { getContext, type VaultContext } from '../lib/context.js';
import { fail, HttpError, type ApiEvent, type ApiResult } from '../lib/http.js';
import { createUpload } from '../routes/create-upload.js';
import { deleteFile } from '../routes/delete-file.js';
import { getDownload } from '../routes/get-download.js';
import { getFile } from '../routes/get-file.js';
import { listAudit } from '../routes/list-audit.js';
import { listFiles } from '../routes/list-files.js';

type Route = (event: ApiEvent, ctx: VaultContext) => Promise<ApiResult>;

const routes: Record<string, Route> = {
  'POST /files': createUpload,
  'GET /files': listFiles,
  'GET /files/{fileId}': getFile,
  'GET /files/{fileId}/download': getDownload,
  'DELETE /files/{fileId}': deleteFile,
  'GET /audit': listAudit,
};

/** One Lambda behind every API route. API Gateway has already verified the Cognito JWT before we run. */
export const handler = async (event: ApiEvent): Promise<ApiResult> => {
  const route = routes[event.routeKey];
  if (!route) return fail(404, 'route not found');
  try {
    return await route(event, getContext());
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    console.error('unhandled error', { routeKey: event.routeKey, requestId: event.requestContext?.requestId }, err);
    return fail(500, 'internal error');
  }
};
