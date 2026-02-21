#!/usr/bin/env bash
set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}PASS${NC} $1"; }
fail() { echo -e "  ${RED}FAIL${NC} $1"; }

# Load env
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.local"
if [[ ! -f "$ENV_FILE" ]]; then
  echo -e "${RED}ERROR: .env.local not found at $ENV_FILE${NC}"
  exit 1
fi

# Parse .env.local with python (handles unquoted JSON values)
eval "$(python3 -c "
import re, shlex
with open('$ENV_FILE') as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        key, _, value = line.partition('=')
        key = key.strip()
        value = value.strip().strip('\"')
        print(f'export {key}={shlex.quote(value)}')
")"

echo "=== IFTTT Webhook Test ==="
echo ""

# Fire a test event that won't match any real applet
EVENT="test_ping"
URL="https://maker.ifttt.com/trigger/${EVENT}/with/key/${IFTTT_WEBHOOK_KEY}"

echo "Firing test event: $EVENT"
RESPONSE=$(curl -s -X POST "$URL")

if echo "$RESPONSE" | grep -qi "congratulations"; then
  pass "IFTTT webhook key is valid"
  echo "       Response: $RESPONSE"
else
  fail "IFTTT webhook returned unexpected response"
  echo "       Response: $RESPONSE"
  exit 1
fi

echo ""
echo -e "${GREEN}All tests passed!${NC}"
