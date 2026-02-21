#!/usr/bin/env bash
set -euo pipefail

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

header()  { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }
applet()  { echo -e "\n${YELLOW}━━━ Applet: $1 ━━━${NC}"; }
val()     { echo -e "  ${GREEN}$1${NC}"; }
err()     { echo -e "${RED}ERROR: $1${NC}"; }

pause() {
  echo ""
  read -rp "  Press Enter to continue..."
}

# ── Step 1: Load credentials from .env.local ──────────────────────────────────

header "Step 1: Loading credentials"

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.local"
if [[ ! -f "$ENV_FILE" ]]; then
  err ".env.local not found at $ENV_FILE"
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

# Validate required credentials
if [[ -z "${YOLINK_UA_CID:-}" || -z "${YOLINK_SECRET_KEY:-}" ]]; then
  err "YOLINK_UA_CID and YOLINK_SECRET_KEY must be set in .env.local"
  exit 1
fi
echo "  YOLINK_UA_CID: found"
echo "  YOLINK_SECRET_KEY: found"

if [[ -z "${IFTTT_WEBHOOK_KEY:-}" ]]; then
  err "IFTTT_WEBHOOK_KEY must be set in .env.local"
  exit 1
fi
echo "  IFTTT_WEBHOOK_KEY: found"

# Determine base URL
BASE_URL=""
if [[ -n "${APP_CONFIG:-}" ]]; then
  BASE_URL=$(python3 -c "
import json, os, sys
try:
    c = json.loads(os.environ['APP_CONFIG'])
    url = c.get('checkStateUrl', '')
    if url:
        print(url.rsplit('/api/', 1)[0])
    else:
        print('')
except Exception:
    print('')
" 2>/dev/null || true)
fi

if [[ -z "$BASE_URL" ]]; then
  echo ""
  echo "  No deployment URL found in APP_CONFIG."
  read -rp "  Enter your Vercel deployment URL (e.g. https://smart-hvac-guardian.vercel.app): " BASE_URL
  # Strip trailing slash
  BASE_URL="${BASE_URL%/}"
fi

if [[ -z "$BASE_URL" ]]; then
  err "Deployment URL is required"
  exit 1
fi
echo "  Deployment URL: $BASE_URL"

SENSOR_EVENT_URL="${BASE_URL}/api/sensor-event"
HVAC_EVENT_URL="${BASE_URL}/api/hvac-event"
CHECK_STATE_URL="${BASE_URL}/api/check-state"
YOLINK_BASE_URL="https://api.yosmart.com/open/yolink/v2/api"

pause

# ── Step 2: Discover sensors from YoLink ──────────────────────────────────────

header "Step 2: Discovering YoLink sensors"

echo "  Authenticating with YoLink..."
TOKEN_URL="https://api.yosmart.com/open/yolink/token"
TOKEN_RESPONSE=$(curl -s -X POST "$TOKEN_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=${YOLINK_UA_CID}&client_secret=${YOLINK_SECRET_KEY}")

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null || true)

if [[ -z "$ACCESS_TOKEN" ]]; then
  err "Failed to get YoLink access token"
  echo "  Response: $TOKEN_RESPONSE"
  exit 1
fi
echo "  Authenticated successfully"

echo "  Fetching device list..."
TIMESTAMP=$(python3 -c "import time; print(int(time.time()*1000))")
DEVICE_LIST_RESPONSE=$(curl -s -X POST "$YOLINK_BASE_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "{\"method\":\"Home.getDeviceList\",\"time\":$TIMESTAMP}")

DEVICE_LIST_CODE=$(echo "$DEVICE_LIST_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('code',''))" 2>/dev/null || true)

if [[ "$DEVICE_LIST_CODE" != "000000" ]]; then
  err "Failed to fetch device list"
  echo "  Response: $DEVICE_LIST_RESPONSE"
  exit 1
fi

# Filter to DoorSensor devices
DOOR_SENSORS_JSON=$(echo "$DEVICE_LIST_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
sensors = []
for d in data['data']['devices']:
    if d.get('type') == 'DoorSensor':
        sensors.append({'id': d['deviceId'], 'name': d['name']})
print(json.dumps(sensors))
")

SENSOR_COUNT=$(echo "$DOOR_SENSORS_JSON" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")

if [[ "$SENSOR_COUNT" -eq 0 ]]; then
  err "No DoorSensor devices found in your YoLink account"
  exit 1
fi

echo ""
echo "  Found $SENSOR_COUNT door sensor(s):"
echo ""
for i in $(seq 0 $((SENSOR_COUNT - 1))); do
  S_NAME=$(echo "$DOOR_SENSORS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)[$i]['name'])")
  S_ID=$(echo "$DOOR_SENSORS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)[$i]['id'])")
  echo "    $((i + 1)). $S_NAME  ($S_ID)"
done

echo ""
read -rp "  Include all sensors? [Y/n] " include_all
if [[ "$include_all" =~ ^[Nn]$ ]]; then
  read -rp "  Enter sensor numbers to include (comma-separated, e.g. 1,3): " sensor_picks
  SELECTED_INDICES=$(python3 -c "
picks = '$sensor_picks'.split(',')
print(','.join(str(int(p.strip()) - 1) for p in picks if p.strip().isdigit()))
")
else
  SELECTED_INDICES=$(python3 -c "print(','.join(str(i) for i in range($SENSOR_COUNT)))")
fi

# Build selected sensors array with delays
SENSORS=()
SENSOR_NAMES=()
SENSOR_IDS=()
SENSOR_DELAYS=()

for idx in $(echo "$SELECTED_INDICES" | tr ',' ' '); do
  S_NAME=$(echo "$DOOR_SENSORS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)[$idx]['name'])")
  S_ID=$(echo "$DOOR_SENSORS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)[$idx]['id'])")
  read -rp "  Delay for '$S_NAME' in seconds [300]: " delay
  delay="${delay:-300}"
  SENSOR_NAMES+=("$S_NAME")
  SENSOR_IDS+=("$S_ID")
  SENSOR_DELAYS+=("$delay")
done

echo ""
echo "  Selected sensors:"
for i in "${!SENSOR_NAMES[@]}"; do
  echo "    - ${SENSOR_NAMES[$i]} (${SENSOR_IDS[$i]}) delay=${SENSOR_DELAYS[$i]}s"
done

pause

# ── Step 3: Collect HVAC unit names ───────────────────────────────────────────

header "Step 3: Enter HVAC units (Cielo Home devices)"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HVAC_DEVICES_FILE="$PROJECT_ROOT/.hvac-devices.json"

HVAC_NAMES=()
HVAC_IDS=()
HVAC_EVENTS=()

# Helper: populate IDs and events from HVAC_NAMES
populate_hvac_ids() {
  HVAC_IDS=()
  HVAC_EVENTS=()
  for name in "${HVAC_NAMES[@]}"; do
    hvac_id=$(python3 -c "
import re, sys
s = sys.argv[1].lower().strip()
s = re.sub(r'[^a-z0-9]+', '_', s)
s = s.strip('_')
print(s)
" "$name")
    HVAC_IDS+=("$hvac_id")
    HVAC_EVENTS+=("turn_off_${hvac_id}")
  done
}

SKIP_ENTRY=false

# Check for saved devices
if [[ -f "$HVAC_DEVICES_FILE" ]]; then
  SAVED_NAMES=()
  while IFS= read -r line; do
    SAVED_NAMES+=("$line")
  done < <(python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    for name in json.load(f):
        print(name)
" "$HVAC_DEVICES_FILE")

  if [[ ${#SAVED_NAMES[@]} -gt 0 ]]; then
    echo ""
    echo "  Found saved HVAC units:"
    for name in "${SAVED_NAMES[@]}"; do
      echo "    - $name"
    done
    echo ""
    read -rp "  Use existing HVAC units? [Y/n] " use_existing
    if [[ ! "$use_existing" =~ ^[Nn]$ ]]; then
      HVAC_NAMES=("${SAVED_NAMES[@]}")
      populate_hvac_ids
      SKIP_ENTRY=true
    fi
  fi
fi

if [[ "$SKIP_ENTRY" == "false" ]]; then
  echo "  Enter your Cielo AC device names one at a time."
  echo ""

  while true; do
    read -rp "  HVAC device name (Enter to finish): " hvac_name

    # Strip whitespace; treat whitespace-only as empty
    hvac_name=$(echo "$hvac_name" | xargs)

    if [[ -z "$hvac_name" ]]; then
      if [[ ${#HVAC_NAMES[@]} -eq 0 ]]; then
        echo "  You must enter at least one HVAC unit."
        continue
      fi
      break
    fi

    # Generate snake_case id
    hvac_id=$(python3 -c "
import re, sys
s = sys.argv[1].lower().strip()
s = re.sub(r'[^a-z0-9]+', '_', s)
s = s.strip('_')
print(s)
" "$hvac_name")
    hvac_event="turn_off_${hvac_id}"

    echo "    ID:    $hvac_id"
    echo "    Event: $hvac_event"

    HVAC_NAMES+=("$hvac_name")
    HVAC_IDS+=("$hvac_id")
    HVAC_EVENTS+=("$hvac_event")
    echo ""
  done
fi

# Save device names for next run
python3 -c "
import json, sys
names = sys.argv[1:]
with open('$HVAC_DEVICES_FILE', 'w') as f:
    json.dump(names, f, indent=2)
" "${HVAC_NAMES[@]}"

echo ""
echo "  HVAC units:"
for i in "${!HVAC_NAMES[@]}"; do
  echo "    - ${HVAC_NAMES[$i]}  (id: ${HVAC_IDS[$i]}, event: ${HVAC_EVENTS[$i]})"
done

pause

# ── Step 4: Generate APP_CONFIG ───────────────────────────────────────────────

header "Step 4: Generated APP_CONFIG"

APP_CONFIG_JSON=$(python3 -c "
import json, sys

sensor_names = $(python3 -c "import json; print(json.dumps([$(printf '"%s",' "${SENSOR_NAMES[@]}")]))")
sensor_ids = $(python3 -c "import json; print(json.dumps([$(printf '"%s",' "${SENSOR_IDS[@]}")]))")
sensor_delays = $(python3 -c "import json; print(json.dumps([$(printf '%s,' "${SENSOR_DELAYS[@]}")]))")
hvac_names = $(python3 -c "import json; print(json.dumps([$(printf '"%s",' "${HVAC_NAMES[@]}")]))")
hvac_ids = $(python3 -c "import json; print(json.dumps([$(printf '"%s",' "${HVAC_IDS[@]}")]))")
hvac_events = $(python3 -c "import json; print(json.dumps([$(printf '"%s",' "${HVAC_EVENTS[@]}")]))")

config = {
    'sensors': [],
    'hvacUnits': [],
    'yolink': {
        'baseUrl': 'https://api.yosmart.com/open/yolink/v2/api'
    },
    'checkStateUrl': '${CHECK_STATE_URL}'
}

for i in range(len(sensor_names)):
    config['sensors'].append({
        'id': sensor_ids[i],
        'name': sensor_names[i],
        'delaySeconds': int(sensor_delays[i])
    })

for i in range(len(hvac_names)):
    config['hvacUnits'].append({
        'id': hvac_ids[i],
        'name': hvac_names[i],
        'iftttEvent': hvac_events[i]
    })

print(json.dumps(config))
")

echo ""
echo "  Copy this value into your .env.local and Vercel environment variables:"
echo ""
echo -e "  ${GREEN}APP_CONFIG=${NC}"
echo ""
echo -e "${GREEN}${APP_CONFIG_JSON}${NC}"
echo ""

# Validate the JSON
python3 -c "import json; json.loads('$APP_CONFIG_JSON')" 2>/dev/null && echo "  (JSON is valid)" || echo -e "  ${RED}(WARNING: JSON validation failed)${NC}"

pause

# ── Step 5: IFTTT Applet Instructions ─────────────────────────────────────────

header "Step 5: IFTTT Applet Instructions"

echo ""
echo "  Create the following applets at https://ifttt.com/create"

# Sensor applets (open + close for each)
APPLET_NUM=0
for i in "${!SENSOR_NAMES[@]}"; do
  S_NAME="${SENSOR_NAMES[$i]}"
  S_ID="${SENSOR_IDS[$i]}"

  APPLET_NUM=$((APPLET_NUM + 1))
  applet "${S_NAME} Opened"
  echo "  Trigger:  YoLink → Door Sensor → ${S_NAME} → Opens"
  echo "  Action:   Webhooks → Make a web request"
  echo "  URL:      ${SENSOR_EVENT_URL}"
  echo "  Method:   POST"
  echo "  Content:  application/json"
  echo "  Body:"
  echo ""
  val "{\"sensorId\":\"${S_ID}\",\"event\":\"open\"}"
  echo ""

  APPLET_NUM=$((APPLET_NUM + 1))
  applet "${S_NAME} Closed"
  echo "  Trigger:  YoLink → Door Sensor → ${S_NAME} → Closes"
  echo "  Action:   Webhooks → Make a web request"
  echo "  URL:      ${SENSOR_EVENT_URL}"
  echo "  Method:   POST"
  echo "  Content:  application/json"
  echo "  Body:"
  echo ""
  val "{\"sensorId\":\"${S_ID}\",\"event\":\"close\"}"
  echo ""
done

# HVAC turn-off applets
for i in "${!HVAC_NAMES[@]}"; do
  H_NAME="${HVAC_NAMES[$i]}"
  H_EVENT="${HVAC_EVENTS[$i]}"

  APPLET_NUM=$((APPLET_NUM + 1))
  applet "Turn Off ${H_NAME}"
  echo "  Trigger:  Webhooks → Receive a web request"
  echo "  Event:    ${H_EVENT}"
  echo "  Action:   Cielo Home → Turn off → ${H_NAME}"
  echo ""
done

# HVAC power-on applets
for i in "${!HVAC_NAMES[@]}"; do
  H_NAME="${HVAC_NAMES[$i]}"
  H_ID="${HVAC_IDS[$i]}"

  APPLET_NUM=$((APPLET_NUM + 1))
  applet "${H_NAME} Turned On"
  echo "  Trigger:  Cielo Home → Turned on → ${H_NAME}"
  echo "  Action:   Webhooks → Make a web request"
  echo "  URL:      ${HVAC_EVENT_URL}"
  echo "  Method:   POST"
  echo "  Content:  application/json"
  echo "  Body:"
  echo ""
  val "{\"hvacId\":\"${H_ID}\",\"event\":\"on\"}"
  echo ""
done

pause

# ── Step 6: Summary Checklist ─────────────────────────────────────────────────

header "Step 6: Summary Checklist"

echo ""
echo "  Create these IFTTT applets:"
echo ""

NUM=0
for i in "${!SENSOR_NAMES[@]}"; do
  NUM=$((NUM + 1))
  echo "  ${NUM}. [ ] ${SENSOR_NAMES[$i]} → Opened → webhook POST"
  NUM=$((NUM + 1))
  echo "  ${NUM}. [ ] ${SENSOR_NAMES[$i]} → Closed → webhook POST"
done
for i in "${!HVAC_NAMES[@]}"; do
  NUM=$((NUM + 1))
  echo "  ${NUM}. [ ] Webhook → Turn off ${HVAC_NAMES[$i]}"
done
for i in "${!HVAC_NAMES[@]}"; do
  NUM=$((NUM + 1))
  echo "  ${NUM}. [ ] ${HVAC_NAMES[$i]} → Turned on → webhook POST"
done

echo ""
echo "  After creating all applets, set APP_CONFIG in:"
echo "    1. [ ] .env.local (for local testing)"
echo "    2. [ ] Vercel environment variables (for production)"
echo ""
echo -e "${GREEN}Setup complete! You have ${NUM} applets to create.${NC}"
