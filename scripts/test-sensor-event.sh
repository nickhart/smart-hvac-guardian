#!/usr/bin/env bash
set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}PASS${NC} $1"; }
fail() { echo -e "  ${RED}FAIL${NC} $1"; FAILURES=$((FAILURES + 1)); }
warn() { echo -e "  ${YELLOW}WARN${NC} $1"; }

FAILURES=0

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

# Parse config
BASE_URL=$(python3 -c "import json,os; c=json.loads(os.environ['APP_CONFIG']); print(c['checkStateUrl'].rsplit('/api/',1)[0])")
FIRST_SENSOR=$(python3 -c "import json,os; c=json.loads(os.environ['APP_CONFIG']); print(c['sensors'][0]['id'])")
FIRST_NAME=$(python3 -c "import json,os; c=json.loads(os.environ['APP_CONFIG']); print(c['sensors'][0]['name'])")

API_URL="${BASE_URL}/api/sensor-event"

echo "=== Sensor Event API Tests ==="
echo "  URL: $API_URL"
echo "  Sensor: $FIRST_NAME ($FIRST_SENSOR)"
echo ""

# Test 1: POST "close" event → expect 200, action: "none"
echo "Test 1: POST close event"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d "{\"sensorId\":\"$FIRST_SENSOR\",\"event\":\"close\"}")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')
ACTION=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('action',''))" 2>/dev/null || true)

if [[ "$HTTP_CODE" == "200" && "$ACTION" == "none" ]]; then
  pass "close event → 200, action=none"
else
  fail "close event → HTTP $HTTP_CODE, action=$ACTION (expected 200, none)"
  echo "       Body: $BODY"
fi

# Test 2: POST "open" event → expect 200, action: "scheduled"
echo ""
echo "Test 2: POST open event"
warn "This will schedule a REAL QStash delayed check!"
read -rp "  Continue? [y/N] " confirm
if [[ "$confirm" =~ ^[Yy]$ ]]; then
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -d "{\"sensorId\":\"$FIRST_SENSOR\",\"event\":\"open\"}")
  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')
  ACTION=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('action',''))" 2>/dev/null || true)

  if [[ "$HTTP_CODE" == "200" && "$ACTION" == "scheduled" ]]; then
    pass "open event → 200, action=scheduled"
  else
    fail "open event → HTTP $HTTP_CODE, action=$ACTION (expected 200, scheduled)"
    echo "       Body: $BODY"
  fi
else
  warn "Skipped open event test"
fi

# Test 3: POST invalid payload → expect 400
echo ""
echo "Test 3: POST invalid payload"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d '{"bad":"data"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -1)

if [[ "$HTTP_CODE" == "400" ]]; then
  pass "invalid payload → 400"
else
  BODY=$(echo "$RESPONSE" | sed '$d')
  fail "invalid payload → HTTP $HTTP_CODE (expected 400)"
  echo "       Body: $BODY"
fi

# Test 4: POST unknown sensor ID → expect 404
echo ""
echo "Test 4: POST unknown sensor ID"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d '{"sensorId":"unknown_sensor_999","event":"open"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -1)

if [[ "$HTTP_CODE" == "404" ]]; then
  pass "unknown sensor → 404"
else
  BODY=$(echo "$RESPONSE" | sed '$d')
  fail "unknown sensor → HTTP $HTTP_CODE (expected 404)"
  echo "       Body: $BODY"
fi

# Summary
echo ""
if [[ $FAILURES -eq 0 ]]; then
  echo -e "${GREEN}All tests passed!${NC}"
else
  echo -e "${RED}$FAILURES test(s) failed.${NC}"
  exit 1
fi
