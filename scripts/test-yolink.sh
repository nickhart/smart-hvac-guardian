#!/usr/bin/env bash
set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}PASS${NC} $1"; }
fail() { echo -e "  ${RED}FAIL${NC} $1"; FAILURES=$((FAILURES + 1)); }

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
YOLINK_BASE_URL=$(python3 -c "import json,os; c=json.loads(os.environ['APP_CONFIG']); print(c['yolink']['baseUrl'])")

TOKEN_URL="https://api.yosmart.com/open/yolink/token"

echo "=== YoLink API Tests ==="
echo ""

# Step 1: Get access token
echo "Fetching access token..."
TOKEN_RESPONSE=$(curl -s -X POST "$TOKEN_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=${YOLINK_UA_CID}&client_secret=${YOLINK_SECRET_KEY}")

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null || true)

if [[ -z "$ACCESS_TOKEN" ]]; then
  fail "Token fetch failed"
  echo "       Response: $TOKEN_RESPONSE"
  exit 1
fi
pass "Access token obtained"
echo ""

# Step 2: Get device list (to retrieve device net tokens)
echo "Fetching device list..."
TIMESTAMP=$(python3 -c "import time; print(int(time.time()*1000))")
DEVICE_LIST_RESPONSE=$(curl -s -X POST "$YOLINK_BASE_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "{\"method\":\"Home.getDeviceList\",\"time\":$TIMESTAMP}")

DEVICE_LIST_CODE=$(echo "$DEVICE_LIST_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('code',''))" 2>/dev/null || true)

if [[ "$DEVICE_LIST_CODE" != "000000" ]]; then
  fail "Device list fetch failed"
  echo "       Response: $DEVICE_LIST_RESPONSE"
  exit 1
fi
pass "Device list obtained"
echo ""

# Step 3: Query each sensor from APP_CONFIG, using device net token from device list
echo "Querying sensors..."
SENSOR_COUNT=$(python3 -c "import json,os; c=json.loads(os.environ['APP_CONFIG']); print(len(c['sensors']))")

for i in $(seq 0 $((SENSOR_COUNT - 1))); do
  SENSOR_ID=$(python3 -c "import json,os; c=json.loads(os.environ['APP_CONFIG']); print(c['sensors'][$i]['id'])")
  SENSOR_NAME=$(python3 -c "import json,os; c=json.loads(os.environ['APP_CONFIG']); print(c['sensors'][$i]['name'])")

  # Look up device net token from device list
  DEVICE_TOKEN=$(echo "$DEVICE_LIST_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for d in data['data']['devices']:
    if d['deviceId'] == '$SENSOR_ID':
        print(d['token'])
        break
else:
    print('')
" 2>/dev/null || true)

  if [[ -z "$DEVICE_TOKEN" ]]; then
    fail "$SENSOR_NAME ($SENSOR_ID) → not found in device list"
    continue
  fi

  TIMESTAMP=$(python3 -c "import time; print(int(time.time()*1000))")
  RESPONSE=$(curl -s -X POST "$YOLINK_BASE_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -d "{\"method\":\"DoorSensor.getState\",\"targetDevice\":\"$SENSOR_ID\",\"token\":\"$DEVICE_TOKEN\",\"time\":$TIMESTAMP}")

  RESP_CODE=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('code',''))" 2>/dev/null || true)

  if [[ "$RESP_CODE" == "000000" ]]; then
    STATE=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['state']['state'])")
    pass "$SENSOR_NAME ($SENSOR_ID) → state: $STATE"
  else
    fail "$SENSOR_NAME ($SENSOR_ID) → query failed"
    echo "       Response: $RESPONSE"
  fi
done

# Summary
echo ""
if [[ $FAILURES -eq 0 ]]; then
  echo -e "${GREEN}All tests passed!${NC}"
else
  echo -e "${RED}$FAILURES test(s) failed.${NC}"
  exit 1
fi
