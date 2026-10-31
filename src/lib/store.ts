import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

export type FileStatus = 'pending' | 'ready' | 'rejected' | 'deleted';

export interface FileRecord {
  pk: string;
  sk: string;
  fileId: string;
  owner: string;
  name: string;
  contentType: string;
  size: number;
  status: FileStatus;
  s3Key: string;
  createdAt: string;
  readyAt?: string;
  deletedAt?: string;
  etag?: string;
  versionId?: string;
  rejectedReason?: string;
}

export type AuditAction = 'upload_url' | 'upload_completed' | 'upload_rejected' | 'download_url' | 'delete';

export interface AuditRecord {
  pk: string;
  sk: string;
  action: AuditAction;
  fileId: string;
  at: string;
  ip?: string;
  userAgent?: string;
  detail?: string;
  /** DynamoDB TTL (epoch seconds) */
  expiresAt?: number;
}

export const fileKey = (owner: string, fileId: string) => ({ pk: `USER#${owner}`, sk: `FILE#${fileId}` });

/** Object keys are owner-prefixed and never contain user input. */
export const objectKey = (owner: string, fileId: string) => `users/${owner}/${fileId}`;

export function parseObjectKey(key: string): { owner: string; fileId: string } | undefined {
  const m = /^users\/([^/]+)\/([^/]+)$/.exec(key);
  return m ? { owner: m[1] as string, fileId: m[2] as string } : undefined;
}

const AUDIT_RETENTION_SECONDS = 90 * 24 * 3600;

/** Single-table access layer. Every query is scoped by the owner's partition key, so cross-user reads are impossible by construction. */
export class VaultStore {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}

  async createFile(record: FileRecord): Promise<void> {
    await this.doc.send(
      new PutCommand({ TableName: this.table, Item: record, ConditionExpression: 'attribute_not_exists(pk)' }),
    );
  }

  async getFile(owner: string, fileId: string): Promise<FileRecord | undefined> {
    const { Item } = await this.doc.send(new GetCommand({ TableName: this.table, Key: fileKey(owner, fileId) }));
    return Item as FileRecord | undefined;
  }

  async listFiles(owner: string, limit = 100): Promise<FileRecord[]> {
    const { Items } = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${owner}`, ':prefix': 'FILE#' },
        Limit: limit,
      }),
    );
    return (Items ?? []) as FileRecord[];
  }

  async updateFile(owner: string, fileId: string, patch: Partial<Omit<FileRecord, 'pk' | 'sk'>>): Promise<void> {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const sets: string[] = [];
    entries.forEach(([k, v], i) => {
      names[`#k${i}`] = k;
      values[`:v${i}`] = v;
      sets.push(`#k${i} = :v${i}`);
    });
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: fileKey(owner, fileId),
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: 'attribute_exists(pk)',
      }),
    );
  }

  async deleteFileRecord(owner: string, fileId: string): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.table, Key: fileKey(owner, fileId) }));
  }

  async addAudit(owner: string, entry: Omit<AuditRecord, 'pk' | 'sk' | 'at' | 'expiresAt'>): Promise<void> {
    const now = new Date();
    const record: AuditRecord = {
      pk: `USER#${owner}`,
      sk: `AUDIT#${now.toISOString()}#${Math.random().toString(36).slice(2, 8)}`,
      at: now.toISOString(),
      expiresAt: Math.floor(now.getTime() / 1000) + AUDIT_RETENTION_SECONDS,
      ...entry,
    };
    await this.doc.send(new PutCommand({ TableName: this.table, Item: record }));
  }

  async listAudit(owner: string, limit = 50): Promise<AuditRecord[]> {
    const { Items } = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${owner}`, ':prefix': 'AUDIT#' },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (Items ?? []) as AuditRecord[];
  }
}
