# Secure File Vault

Private file storage on AWS, serverless, built the way a security review
expects it: every object encrypted with a customer-managed KMS key, uploads
and downloads through short-lived presigned URLs, a Cognito-protected API,
per-user isolation that holds by construction, server-side verification of
every upload, a full audit trail, and least-privilege IAM. Deployed with
Terraform in one apply. Costs about a dollar a month when idle.

[![CI](https://github.com/buildwithhemant/secure-file-vault/actions/workflows/ci.yml/badge.svg)](https://github.com/buildwithhemant/secure-file-vault/actions/workflows/ci.yml)
![AWS](https://img.shields.io/badge/AWS-S3%20%C2%B7%20KMS%20%C2%B7%20Lambda%20%C2%B7%20Cognito-232F3E)
![Terraform](https://img.shields.io/badge/Terraform-1.6%2B-7B42BC?logo=terraform&logoColor=white)
![Node 22](https://img.shields.io/badge/Lambda-Node.js%2022-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![License MIT](https://img.shields.io/badge/license-MIT-lightgrey)

## What it solves

"Users upload documents, we store them in S3" is a one-day feature and a
one-year liability. The usual holes: a bucket that is one policy change away
from public, files readable by anyone who guesses a URL, no encryption
beyond the default, uploads that never get validated, and no answer to "who
downloaded this and when?". This project closes each of them.

| Risk | Control in this project |
|---|---|
| Data exposed at rest | SSE-KMS with a customer-managed key, rotation on. Bucket policy denies any upload that is not KMS-encrypted or uses another key |
| Public or over-broad bucket access | Block Public Access on, bucket owner enforced, TLS-only policy, no IAM user or role has `s3:*` |
| One user reading another's files | Object keys are `users/<sub>/<id>`; the API only ever queries the caller's partition; the Lambda role can only touch `users/*` |
| Leaked or replayed links | Presigned URLs expire in minutes (upload) or seconds (download) and are pinned to one key, size, type and KMS key |
| Clients uploading something other than what they declared | A Lambda verifies every object after upload (encryption, key, size, type) and deletes anything that does not match or was never registered |
| Accidental or malicious deletion | Versioned bucket; deletes are markers, recoverable until the lifecycle rule expires old versions |
| "Who accessed this?" | Every issued upload/download link and every delete is written to an audit trail with IP and user agent; S3 access logs and API access logs on top |
| Silent failures | CloudWatch alarms on function errors, API 5xx and the verification dead-letter queue, delivered to an SNS topic |

Trivy's misconfiguration scan runs in CI and reports zero findings on the
Terraform.

## Architecture

```
              Cognito user pool (invite-only, strong passwords, optional MFA)
                                   │ JWT
                                   ▼
   client ───▶ API Gateway (HTTP API, JWT authorizer, throttled, access-logged)
                                   │
                                   ▼
                       Lambda "api" (Node.js 22, arm64)
                 POST /files · GET /files · GET /files/{id}
                 GET /files/{id}/download · DELETE /files/{id} · GET /audit
                        │                          │
                        │ metadata + audit         │ presigned PUT / GET
                        ▼                          ▼
              DynamoDB (KMS, PITR)        S3 data bucket (SSE-KMS, versioned,
                        ▲                  TLS-only, public access blocked)
                        │                          │ ObjectCreated
                        │                          ▼
                        └──────────── Lambda "finalize" ──▶ verify ▶ ready / rejected+deleted
                                           │ failures after retries
                                           ▼
                                      SQS dead-letter queue (alarmed)
```

The API never proxies file bytes. Clients talk to S3 directly with presigned
URLs, so large files cost nothing in Lambda time and the API stays fast.

## Deploy

Prerequisites: an AWS account and credentials with permission to create the
resources, Terraform 1.6+, Node.js 20+.

```bash
git clone https://github.com/buildwithhemant/secure-file-vault.git
cd secure-file-vault
npm install
npm run build                                   # bundles the two Lambdas into dist/

cp infra/terraform.tfvars.example infra/terraform.tfvars   # edit region, limits, alarm email
terraform -chdir=infra init
terraform -chdir=infra apply
```

Apply creates about 45 resources and takes two to three minutes. For anything
beyond a sandbox, uncomment the S3 backend block in `infra/versions.tf` so
state lives outside your laptop.

**Running cost.** KMS key about $1/month. Everything else is pay-per-use
(Lambda, DynamoDB on-demand, HTTP API, S3 storage and requests) and within
the free tier for light use. Cognito is free for the first 10,000 monthly
active users.

## Try it

The user pool is invite-only, so create a user first:

```bash
scripts/create-test-user.sh you@example.com 'Str0ng!Passw0rd!'

export VAULT_API_URL=$(terraform -chdir=infra output -raw api_url)
export COGNITO_CLIENT_ID=$(terraform -chdir=infra output -raw user_pool_client_id)
export AWS_REGION=$(terraform -chdir=infra output -raw aws_region)
eval "$(npm run -s cli -- login you@example.com 'Str0ng!Passw0rd!')"

npm run -s cli -- upload ./invoice.pdf
# uploaded ./invoice.pdf as 3f1c...-...  (48213 bytes), waiting for verification...
# status: ready

npm run -s cli -- list
npm run -s cli -- download 3f1c...-... ./copy.pdf
npm run -s cli -- audit
```

To see the verification step reject something, upload with a wrong size or
content type using the presigned URL directly: the object is deleted within
seconds and the file shows `status: rejected` with the reason.

## API

All routes need `Authorization: Bearer <Cognito ID token>`. The caller's
identity is taken from the verified token only.

| Method | Path | What it does |
|---|---|---|
| `POST` | `/files` | Body `{ "name", "contentType", "size" }`. Registers the file, returns a presigned `PUT` URL plus the headers the client must send. 201 |
| `GET` | `/files` | Lists the caller's files (not deleted ones) |
| `GET` | `/files/{fileId}` | Metadata and status: `pending`, `ready`, `rejected`, `deleted` |
| `GET` | `/files/{fileId}/download` | Presigned `GET` valid for 60 seconds, served with the original filename. Audited |
| `DELETE` | `/files/{fileId}` | Writes a delete marker and marks the record deleted. Audited |
| `GET` | `/audit` | The caller's last 50 audit entries, newest first |

Upload sequence:

1. `POST /files` with the declared name, type and size.
2. `PUT` the bytes to the returned URL with exactly the returned headers.
3. S3 triggers the verification function. Within a second or two the file is
   `ready`, or `rejected` with a reason and the object is gone.

## Configuration

| Terraform variable | Default | Purpose |
|---|---|---|
| `aws_region` | `ap-south-1` | Deployment region |
| `environment` | `dev` | `dev`, `staging` or `prod`; `prod` turns on deletion protection for the table and user pool |
| `max_file_size_bytes` | 100 MiB | Largest upload the API will sign |
| `allowed_content_types` | `*` | Allow-list such as `image/*,application/pdf` |
| `upload_url_ttl_seconds` / `download_url_ttl_seconds` | 300 / 60 | Presigned URL lifetimes |
| `cors_allowed_origins` | `["http://localhost:3000"]` | Browser origins allowed to call the API |
| `alarm_email` | empty | Email subscribed to the alarm topic |
| `log_retention_days` | 30 | Lambda, API access and S3 access log retention |
| `noncurrent_version_expiration_days` | 30 | How long deleted or overwritten versions stay recoverable |
| `throttling_burst_limit` / `throttling_rate_limit` | 50 / 25 | API Gateway throttling |
| `force_destroy` | `false` | Allow `destroy` to remove non-empty buckets (dev only) |

## Operations

- **Alarms.** Function errors, API 5xx and messages in the verification
  dead-letter queue each raise an alarm on the SNS topic.
- **Recovery.** A deleted file is a delete marker on a versioned bucket. Remove
  the marker within the retention window and the bytes are back. Metadata has
  point-in-time recovery.
- **Key rotation.** The KMS key rotates yearly. Old material stays available
  for decryption, nothing needs re-encrypting.
- **Logs.** Function logs and API access logs in CloudWatch with retention,
  S3 server access logs in a separate bucket, X-Ray tracing on both functions.
- **Tear down.** `terraform -chdir=infra destroy`. With `force_destroy = false`
  Terraform refuses to delete buckets that still hold objects, which is the
  point.

## Development

```bash
npm run typecheck        # strict TypeScript, tests included
npm test                 # 34 unit tests, AWS SDK mocked with aws-sdk-client-mock
npm run build            # esbuild bundles per function
npm run tf:fmt           # terraform fmt
npm run tf:validate      # terraform init -backend=false && validate
docker run --rm -v "$PWD/infra:/infra:ro" aquasec/trivy config /infra   # security scan
```

The tests cover the presigned-URL contract (key, type, size, KMS headers),
input validation, per-user scoping, every verification outcome (ready,
wrong key, unencrypted, size or type mismatch, orphan object), deletion,
auditing and error handling. CI runs the same checks plus `terraform validate`
and the Trivy scan on every push.

## Project structure

```
src/
  handlers/api.ts         router for the six API routes
  handlers/finalize.ts    S3-triggered upload verification
  routes/                 one file per route
  lib/                    config, HTTP helpers, validation, DynamoDB store, AWS clients
infra/                    Terraform: kms, s3, dynamodb, iam, lambda, api, cognito, monitoring
scripts/                  vault-cli.ts (end-to-end client), create-test-user.sh
test/                     unit tests
```

## Not included, on purpose

No web UI, no sharing between users, no antivirus scanning (the verification
hook is the place to add one), no multipart uploads above the single-PUT
limit of 5 GB. The project does one job: store private files safely.

## License

MIT. Built by [Hemant V.](https://github.com/buildwithhemant), a backend and
cloud engineer. Need secure file handling, AWS hardening or a serverless API
done properly? [Hire me on Upwork](https://www.upwork.com/freelancers/~01a3fb9f082a691ba1).
