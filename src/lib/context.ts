import type { S3Client } from '@aws-sdk/client-s3';
import { doc, s3 } from './clients.js';
import { loadConfig, type VaultConfig } from './config.js';
import { VaultStore } from './store.js';

export interface VaultContext {
  cfg: VaultConfig;
  store: VaultStore;
  s3: S3Client;
}

let cached: VaultContext | undefined;

export function getContext(): VaultContext {
  if (!cached) {
    const cfg = loadConfig();
    cached = { cfg, store: new VaultStore(doc, cfg.tableName), s3 };
  }
  return cached;
}

export function toPublicFile(f: {
  fileId: string;
  name: string;
  contentType: string;
  size: number;
  status: string;
  createdAt: string;
  readyAt?: string;
  deletedAt?: string;
  rejectedReason?: string;
}) {
  return {
    fileId: f.fileId,
    name: f.name,
    contentType: f.contentType,
    size: f.size,
    status: f.status,
    createdAt: f.createdAt,
    readyAt: f.readyAt,
    deletedAt: f.deletedAt,
    rejectedReason: f.rejectedReason,
  };
}
