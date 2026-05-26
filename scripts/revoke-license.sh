#!/usr/bin/env bash
# Revoke a Shop OS license key.
#
# Usage:
#   ./scripts/revoke-license.sh SHOP-XXXX-YYYY-ZZZZ
#
# Requires WORKER_URL and ADMIN_TOKEN env vars (see issue-license.sh).

set -euo pipefail

if [[ -z "${WORKER_URL:-}" || -z "${ADMIN_TOKEN:-}" ]]; then
  echo "ERROR: WORKER_URL and ADMIN_TOKEN env vars must be set." >&2
  exit 2
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <license-key>" >&2
  exit 2
fi

KEY="$1"

RESP=$(curl -sS -X POST "$WORKER_URL/revoke?key=$KEY" \
  -H "authorization: Bearer $ADMIN_TOKEN")

echo "$RESP" | python3 -m json.tool 2>/dev/null || echo "$RESP"
