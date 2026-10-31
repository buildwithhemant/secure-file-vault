/**
 * Minimal client for the vault API, showing the whole flow end to end:
 * login -> presigned upload -> verification -> list -> presigned download -> audit.
 *
 *   export VAULT_API_URL=$(terraform -chdir=infra output -raw api_url)
 *   export COGNITO_CLIENT_ID=$(terraform -chdir=infra output -raw user_pool_client_id)
 *   export AWS_REGION=$(terraform -chdir=infra output -raw aws_region)
 *   eval "$(npm run -s cli -- login you@example.com 'YourPassw0rd!')"
 *   npm run -s cli -- upload ./invoice.pdf
 *   npm run -s cli -- list
 *   npm run -s cli -- download <fileId> ./copy.pdf
 *   npm run -s cli -- audit
 */
import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [command, ...args] = process.argv.slice(2);
const apiUrl = (process.env.VAULT_API_URL ?? '').replace(/\/$/, '');

function need(value: string | undefined, name: string): string {
  if (!value) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return value;
}

async function api<T = any>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${need(apiUrl, 'VAULT_API_URL')}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${need(process.env.VAULT_TOKEN, 'VAULT_TOKEN (run the login command first)')}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status} ${text}`);
  return JSON.parse(text) as T;
}

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
};
const contentTypeFor = (file: string) => MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

switch (command) {
  case 'login': {
    const [username, password] = args;
    const client = new CognitoIdentityProviderClient({ region: need(process.env.AWS_REGION, 'AWS_REGION') });
    const out = await client.send(
      new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: need(process.env.COGNITO_CLIENT_ID, 'COGNITO_CLIENT_ID'),
        AuthParameters: { USERNAME: need(username, 'username'), PASSWORD: need(password, 'password') },
      }),
    );
    const idToken = out.AuthenticationResult?.IdToken;
    if (!idToken) throw new Error(`login did not return a token (challenge: ${out.ChallengeName ?? 'none'})`);
    console.log(`export VAULT_TOKEN=${idToken}`);
    break;
  }

  case 'upload': {
    const file = need(args[0], 'file path');
    const size = statSync(file).size;
    const created = await api('POST', '/files', { name: path.basename(file), contentType: contentTypeFor(file), size });
    const put = await fetch(created.upload.url, { method: 'PUT', headers: created.upload.headers, body: readFileSync(file) });
    if (!put.ok) throw new Error(`S3 upload failed: ${put.status} ${await put.text()}`);
    console.log(`uploaded ${file} as ${created.fileId} (${size} bytes), waiting for verification...`);
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      const f = await api('GET', `/files/${created.fileId}`);
      if (f.status !== 'pending') {
        console.log(`status: ${f.status}${f.rejectedReason ? ` (${f.rejectedReason})` : ''}`);
        break;
      }
    }
    break;
  }

  case 'list': {
    const { files } = await api('GET', '/files');
    console.table(files.map((f: any) => ({ fileId: f.fileId, name: f.name, size: f.size, status: f.status, createdAt: f.createdAt })));
    break;
  }

  case 'download': {
    const fileId = need(args[0], 'fileId');
    const d = await api('GET', `/files/${fileId}/download`);
    const res = await fetch(d.download.url);
    if (!res.ok) throw new Error(`S3 download failed: ${res.status} ${await res.text()}`);
    const target = args[1] ?? d.name;
    writeFileSync(target, Buffer.from(await res.arrayBuffer()));
    console.log(`saved ${target} (${d.size} bytes)`);
    break;
  }

  case 'delete': {
    console.log(await api('DELETE', `/files/${need(args[0], 'fileId')}`));
    break;
  }

  case 'audit': {
    const { audit } = await api('GET', '/audit');
    console.table(audit);
    break;
  }

  default:
    console.error('usage: vault-cli <login <email> <password> | upload <file> | list | download <fileId> [out] | delete <fileId> | audit>');
    process.exit(1);
}
