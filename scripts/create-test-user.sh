#!/usr/bin/env bash
# Creates (or resets the password of) a user in the vault's Cognito pool.
# The pool is invite-only, so this is the only way in.
#
#   scripts/create-test-user.sh you@example.com 'Str0ng!Passw0rd!'
set -euo pipefail

EMAIL="${1:?usage: create-test-user.sh <email> <password>}"
PASSWORD="${2:?usage: create-test-user.sh <email> <password>}"
INFRA="$(cd "$(dirname "$0")/../infra" && pwd)"

POOL_ID=$(terraform -chdir="$INFRA" output -raw user_pool_id)
REGION=$(terraform -chdir="$INFRA" output -raw aws_region)

aws cognito-idp admin-create-user \
  --region "$REGION" --user-pool-id "$POOL_ID" --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
  --message-action SUPPRESS >/dev/null 2>&1 || true

aws cognito-idp admin-set-user-password \
  --region "$REGION" --user-pool-id "$POOL_ID" --username "$EMAIL" \
  --password "$PASSWORD" --permanent

cat <<EOF
User $EMAIL is ready. Next:

  export VAULT_API_URL=$(terraform -chdir="$INFRA" output -raw api_url)
  export COGNITO_CLIENT_ID=$(terraform -chdir="$INFRA" output -raw user_pool_client_id)
  export AWS_REGION=$REGION
  eval "\$(npm run -s cli -- login $EMAIL '<password>')"
  npm run -s cli -- upload ./some-file.pdf
EOF
