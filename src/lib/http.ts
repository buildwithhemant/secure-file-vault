import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export type ApiEvent = APIGatewayProxyEventV2WithJWTAuthorizer;
export type ApiResult = APIGatewayProxyStructuredResultV2;

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(statusCode: number, body: unknown): ApiResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  };
}

export function fail(statusCode: number, message: string): ApiResult {
  return json(statusCode, { error: message });
}

/** Identity comes only from the JWT that API Gateway already verified. Nothing in the body or path is trusted for it. */
export function getClaims(event: ApiEvent): { sub: string; email: string | undefined } {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  const sub = claims?.sub;
  if (typeof sub !== 'string' || !sub) throw new HttpError(401, 'unauthenticated');
  const email = typeof claims.email === 'string' ? claims.email : undefined;
  return { sub, email };
}

export function parseJsonBody(event: ApiEvent): unknown {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'body must be valid JSON');
  }
}

export function requestMeta(event: ApiEvent): { ip: string | undefined; userAgent: string | undefined } {
  return { ip: event.requestContext?.http?.sourceIp, userAgent: event.requestContext?.http?.userAgent };
}

export function pathParam(event: ApiEvent, name: string): string {
  const v = event.pathParameters?.[name];
  if (!v || !/^[A-Za-z0-9-]{1,64}$/.test(v)) throw new HttpError(400, `invalid ${name}`);
  return v;
}
