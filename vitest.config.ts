import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    env: {
      TABLE_NAME: 'vault-files-test',
      BUCKET_NAME: 'vault-data-test',
      KMS_KEY_ARN: 'arn:aws:kms:ap-south-1:123456789012:key/11111111-2222-3333-4444-555555555555',
      MAX_FILE_SIZE_BYTES: '1048576',
      ALLOWED_CONTENT_TYPES: 'image/*,application/pdf,text/plain',
      UPLOAD_URL_TTL_SECONDS: '300',
      DOWNLOAD_URL_TTL_SECONDS: '60',
      AWS_REGION: 'ap-south-1',
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
    },
  },
});
