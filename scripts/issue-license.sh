#!/usr/bin/env bash
# Issue a new Shop OS license key by calling the deployed Worker.
#
# Usage:
#   ./scripts/issue-license.sh "Customer Name" "customer@email.com"
#   ./scripts/issue-license.sh "Customer Name" "customer@email.com" "shop-os-foundation" "foundation,marketing-pack"
#
# Requires:
#   - WORKER_URL env var (e.g. https://shop-os-license-server.YOUR-SUBDOMAIN.workers.dev)
#   - ADMIN_TOKEN env var (same value set via `wrangler secret put ADMIN_TOKEN`)
#
# Best to put these in your shell rc or a sourced .env file. NEVER commit.

set -euo pipefail

if [[ -z "${WORKER_URL:-}" || -z "${ADMIN_TOKEN:-}" ]]; then
  echo "ERROR: WORKER_URL and ADMIN_TOKEN env vars must be set." >&2
  echo "  export WORKER_URL='https://shop-os-license-server.YOUR-SUBDOMAIN.workers.dev'" >&2
  echo "  export ADMIN_TOKEN='your-admin-token'" >&2
  exit 2
fi

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <customer-name> <email> [product] [entitlements-csv] [valid-until-iso-or-empty]" >&2
  exit 2
fi

CUSTOMER="$1"
EMAIL="$2"
PRODUCT="${3:-shop-os-foundation}"
ENTITLEMENTS_CSV="${4:-foundation}"
VALID_UNTIL="${5:-}"

# Build JSON. Convert CSV entitlements to a JSON array.
ENTITLEMENTS_JSON=$(printf '%s\n' "$ENTITLEMENTS_CSV" | awk -F',' '{
  printf "["
  for (i=1; i<=NF; i++) {
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", $i)
    printf "\"%s\"%s", $i, (i<NF ? "," : "")
  }
  printf "]"
}')

if [[ -n "$VALID_UNTIL" ]]; then
  VALID_UNTIL_FIELD=",\"valid_until\":\"$VALID_UNTIL\""
else
  VALID_UNTIL_FIELD=""
fi

BODY=$(cat <<EOF
{"customer":"$CUSTOMER","email":"$EMAIL","product":"$PRODUCT","entitlements":$ENTITLEMENTS_JSON$VALID_UNTIL_FIELD}
EOF
)

RESP=$(curl -sS -X POST "$WORKER_URL/issue" \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d "$BODY")

echo "$RESP" | python3 -m json.tool 2>/dev/null || echo "$RESP"
