import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';

// Created once per container and reused across invocations.
export const s3 = new S3Client({});
export const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
