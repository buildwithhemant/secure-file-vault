import type { ApiEvent } from '../src/lib/http.js';

export const SUB = 'user-aaaa-bbbb';

export function makeEvent(opts: {
  routeKey: string;
  body?: unknown;
  pathParameters?: Record<string, string>;
  sub?: string | null;
}): ApiEvent {
  const [method, path] = opts.routeKey.split(' ') as [string, string];
  const claims = opts.sub === null ? {} : { sub: opts.sub ?? SUB, email: 'user@example.com' };
  return {
    version: '2.0',
    routeKey: opts.routeKey,
    rawPath: path,
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    requestContext: {
      accountId: '123456789012',
      apiId: 'api123',
      domainName: 'api.example.test',
      domainPrefix: 'api',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '203.0.113.9', userAgent: 'vitest' },
      requestId: 'req-1',
      routeKey: opts.routeKey,
      stage: '$default',
      time: '01/Nov/2026:00:00:00 +0000',
      timeEpoch: 1_793_491_200_000,
      authorizer: { principalId: SUB, integrationLatency: 1, jwt: { claims, scopes: [] } },
    },
    isBase64Encoded: false,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    pathParameters: opts.pathParameters,
  } as unknown as ApiEvent;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parse(result: { body?: string }): any {
  return JSON.parse(result.body ?? '{}');
}
