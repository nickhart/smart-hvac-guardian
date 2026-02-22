#!/usr/bin/env bash
set -euo pipefail

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
DIM='\033[2m'
NC='\033[0m'

header()  { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }
applet()  { echo -e "\n${YELLOW}━━━ Applet: $1 ━━━${NC}"; }
val()     { echo -e "  ${GREEN}$1${NC}"; }
err()     { echo -e "${RED}ERROR: $1${NC}"; }
dim()     { echo -e "  ${DIM}$1${NC}"; }

pause() {
  echo ""
  read -rp "  Press Enter to continue..."
}

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZONE_CONFIG_FILE="$PROJECT_ROOT/.zone-config.json"
HVAC_DEVICES_FILE="$PROJECT_ROOT/.hvac-devices.json"

# ── Step 1: Load credentials from .env.local ──────────────────────────────────

header "Step 1: Loading credentials"

ENV_FILE="$PROJECT_ROOT/.env.local"
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

if [[ -z "${QSTASH_TOKEN:-}" || -z "${QSTASH_CURRENT_SIGNING_KEY:-}" || -z "${QSTASH_NEXT_SIGNING_KEY:-}" ]]; then
  err "QSTASH_TOKEN, QSTASH_CURRENT_SIGNING_KEY, and QSTASH_NEXT_SIGNING_KEY must be set in .env.local"
  exit 1
fi
echo "  QSTASH credentials: found"

if [[ -z "${UPSTASH_REDIS_REST_URL:-}" || -z "${UPSTASH_REDIS_REST_TOKEN:-}" ]]; then
  err "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set in .env.local"
  exit 1
fi
echo "  Upstash Redis credentials: found"

# Determine base URL
BASE_URL=""
if [[ -n "${APP_CONFIG:-}" ]]; then
  BASE_URL=$(python3 -c "
import json, os, sys
try:
    c = json.loads(os.environ['APP_CONFIG'])
    url = c.get('turnOffUrl', '')
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
TURN_OFF_URL="${BASE_URL}/api/hvac-turn-off"
YOLINK_BASE_URL="https://api.yosmart.com/open/yolink/v2/api"

pause

# ── Step 2: Discover YoLink sensors ───────────────────────────────────────────

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

pause

# ── Step 3: Define zones ──────────────────────────────────────────────────────

header "Step 3: Define zones"

# Check for saved zone config
USE_SAVED_CONFIG=false
if [[ -f "$ZONE_CONFIG_FILE" ]]; then
  echo ""
  echo "  Found saved zone configuration:"
  echo ""
  python3 -c "
import json
with open('$ZONE_CONFIG_FILE') as f:
    config = json.load(f)
hvac_units = config.get('hvacUnits', {})
for zname, zdata in config.get('zones', {}).items():
    hvac_names = [hvac_units.get(m, {}).get('name', m) for m in zdata.get('minisplits', [])]
    hvacs = ', '.join(hvac_names) or '(none)'
    ext = len(zdata.get('exteriorOpenings', []))
    intr = len(zdata.get('interiorDoors', []))
    print(f'    {zname}: HVAC=[{hvacs}], {ext} exterior, {intr} interior doors')
"
  echo ""
  read -rp "  Use existing zone config? [Y/n] " use_existing
  if [[ ! "$use_existing" =~ ^[Nn]$ ]]; then
    USE_SAVED_CONFIG=true
  fi
fi

if [[ "$USE_SAVED_CONFIG" == "false" ]]; then

  # Build zone config via an interactive Python script that handles
  # the full zone definition loop including interior door mirroring.
  # Sensors passed as argv[1]; user input read from /dev/tty; JSON output to stdout.
  ZONE_CONFIG_JSON=$(python3 - "$DOOR_SENSORS_JSON" << 'PYEOF'
import json, re, sys

tty = open('/dev/tty', 'r')

def snake_case(name):
    s = name.lower().strip()
    s = re.sub(r'[^a-z0-9]+', '_', s)
    return s.strip('_')

def read_input(prompt, default=None):
    if default is not None:
        full = f"  {prompt} [{default}]: "
    else:
        full = f"  {prompt}: "
    sys.stderr.write(full)
    sys.stderr.flush()
    val = tty.readline().strip()
    return val if val else (default if default is not None else "")

def read_yesno(prompt, default_yes=True):
    suffix = "[Y/n]" if default_yes else "[y/N]"
    sys.stderr.write(f"  {prompt} {suffix} ")
    sys.stderr.flush()
    val = tty.readline().strip().lower()
    if default_yes:
        return val not in ('n', 'no')
    else:
        return val in ('y', 'yes')

# Load discovered sensors from argument
sensors = json.loads(sys.argv[1])

# Track state
zones = {}
sensor_delays = {}
sensor_defaults = {}
hvac_units = {}
assigned_exterior = set()
mirror_doors = {}

zone_num = 0

while True:
    zone_num += 1
    default_name = f"z{zone_num}"

    sys.stderr.write(f"\n  ── Zone {zone_num} ──\n")

    # 1. Zone name
    zone_name = read_input("Zone name", default_name)
    zone_id = snake_case(zone_name)
    sys.stderr.write(f"    Zone ID: {zone_id}\n")

    # 2. HVAC units for this zone
    sys.stderr.write(f"\n  Enter HVAC units for '{zone_name}' (one per line, Enter to finish):\n")
    zone_hvac_ids = []
    zone_hvac_names = {}
    while True:
        name = read_input("  HVAC device name (Enter to finish)")
        if not name:
            if not zone_hvac_ids:
                sys.stderr.write("    You must enter at least one HVAC unit.\n")
                continue
            break
        hid = snake_case(name)
        event = f"turn_off_{hid}"
        sys.stderr.write(f"      ID: {hid}, Event: {event}\n")
        zone_hvac_ids.append(hid)
        zone_hvac_names[hid] = name
        hvac_units[hid] = {"name": name, "iftttEvent": event}

    # 3. Exterior sensors
    sys.stderr.write(f"\n  Available sensors for exterior openings:\n")
    for idx, s in enumerate(sensors):
        tag = " [assigned]" if s['id'] in assigned_exterior else ""
        sys.stderr.write(f"    {idx+1}. {s['name']}  ({s['id']}){tag}\n")

    ext_picks_str = read_input("Select exterior sensors by number (comma-separated, Enter to skip)", "")
    zone_exterior = []
    if ext_picks_str:
        for p in ext_picks_str.split(','):
            p = p.strip()
            if p.isdigit():
                idx = int(p) - 1
                if 0 <= idx < len(sensors):
                    sid = sensors[idx]['id']
                    if sid in assigned_exterior:
                        sys.stderr.write(f"    Warning: {sensors[idx]['name']} is already assigned. Skipping.\n")
                        continue
                    delay = read_input(f"Delay for '{sensors[idx]['name']}' in seconds", "300")
                    try:
                        delay = int(delay)
                    except ValueError:
                        delay = 300
                    zone_exterior.append(sid)
                    sensor_delays[sid] = delay
                    assigned_exterior.add(sid)

    # 4. Interior doors
    pre_configured = mirror_doors.get(zone_id, [])
    zone_interior = []

    if pre_configured:
        sys.stderr.write(f"\n  Interior doors (pre-configured from other zones):\n")
        for door in pre_configured:
            sys.stderr.write(f"    - {door['sensorName']} \u2192 {door['connectsTo']}")
            if not door['installed']:
                sys.stderr.write(" [pending hardware]")
            sys.stderr.write("\n")
            zone_interior.append({"id": door['id'], "connectsTo": door['connectsTo']})

    if pre_configured:
        add_more = read_yesno("Add more interior doors?", default_yes=False)
    else:
        add_more = read_yesno("Add interior doors?", default_yes=False)

    if add_more:
        sys.stderr.write(f"\n  Available sensors for interior doors:\n")
        for idx, s in enumerate(sensors):
            tag = ""
            if s['id'] in assigned_exterior:
                tag = " [exterior]"
            sys.stderr.write(f"    {idx+1}. {s['name']}  ({s['id']}){tag}\n")

        while True:
            pick_str = read_input("  Interior door sensor number (Enter to finish)", "")
            if not pick_str:
                break
            if not pick_str.isdigit():
                continue
            idx = int(pick_str) - 1
            if idx < 0 or idx >= len(sensors):
                sys.stderr.write("    Invalid number.\n")
                continue

            s = sensors[idx]
            connects_to = read_input(f"  Zone that '{s['name']}' connects to")
            connects_to_id = snake_case(connects_to)

            installed = read_yesno(f"Is '{s['name']}' installed?", default_yes=False)

            if installed:
                delay = read_input(f"  Delay for '{s['name']}' in seconds", "0")
                try:
                    delay = int(delay)
                except ValueError:
                    delay = 0
                sensor_delays[s['id']] = delay
            else:
                sensor_delays[s['id']] = 0
                sensor_defaults[s['id']] = "open"

            zone_interior.append({"id": s['id'], "connectsTo": connects_to_id})

            # Auto-create mirror entry for the connected zone
            if connects_to_id not in mirror_doors:
                mirror_doors[connects_to_id] = []
            already_mirrored = any(
                d['id'] == s['id'] and d['connectsTo'] == zone_id
                for d in mirror_doors[connects_to_id]
            )
            if not already_mirrored:
                mirror_doors[connects_to_id].append({
                    "id": s['id'],
                    "connectsTo": zone_id,
                    "sensorName": s['name'],
                    "installed": installed
                })

    # Store zone
    zones[zone_id] = {
        "minisplits": zone_hvac_ids,
        "exteriorOpenings": zone_exterior,
        "interiorDoors": zone_interior,
        "hvacNames": zone_hvac_names
    }

    # Zone summary
    sys.stderr.write(f"\n  Zone '{zone_id}' summary:\n")
    sys.stderr.write(f"    HVAC: {', '.join(zone_hvac_ids)}\n")
    sys.stderr.write(f"    Exterior: {len(zone_exterior)} sensor(s)\n")
    sys.stderr.write(f"    Interior: {len(zone_interior)} door(s)\n")

    if not read_yesno("Add another zone?", default_yes=True):
        break

# Output the zone config as JSON (to stdout)
output = {
    "zones": {},
    "sensorDelays": sensor_delays,
    "sensorDefaults": sensor_defaults,
    "hvacUnits": hvac_units,
}

# Separate hvacNames for display use, keep zones clean for APP_CONFIG
hvac_names_map = {}
for zid, zdata in zones.items():
    output["zones"][zid] = {
        "minisplits": zdata["minisplits"],
        "exteriorOpenings": zdata["exteriorOpenings"],
        "interiorDoors": zdata["interiorDoors"],
    }
    hvac_names_map.update(zdata["hvacNames"])

output["_hvacNames"] = hvac_names_map

print(json.dumps(output))
PYEOF
  )

fi  # end of USE_SAVED_CONFIG check

# If we loaded from saved config, read the file
if [[ "$USE_SAVED_CONFIG" == "true" ]]; then
  ZONE_CONFIG_JSON=$(cat "$ZONE_CONFIG_FILE")
fi

# Extract pieces from ZONE_CONFIG_JSON for later steps
# Build lookup arrays for display in IFTTT instructions

# Get sensor name map (id -> name) from discovered sensors
SENSOR_NAME_MAP_JSON=$(echo "$DOOR_SENSORS_JSON" | python3 -c "
import sys, json
sensors = json.load(sys.stdin)
print(json.dumps({s['id']: s['name'] for s in sensors}))
")

pause

# ── Step 4: Generate APP_CONFIG ───────────────────────────────────────────────

header "Step 4: Generated APP_CONFIG"

APP_CONFIG_JSON=$(python3 -c "
import json, sys

zone_config = json.loads(sys.argv[1])
turn_off_url = sys.argv[2]
yolink_base = sys.argv[3]

# Build the APP_CONFIG (without internal-only fields)
config = {
    'zones': zone_config['zones'],
    'sensorDelays': zone_config['sensorDelays'],
    'sensorDefaults': zone_config.get('sensorDefaults', {}),
    'hvacUnits': zone_config['hvacUnits'],
    'yolink': {'baseUrl': yolink_base},
    'turnOffUrl': turn_off_url,
}

# Remove sensorDefaults if empty
if not config['sensorDefaults']:
    del config['sensorDefaults']

print(json.dumps(config))
" "$ZONE_CONFIG_JSON" "$TURN_OFF_URL" "$YOLINK_BASE_URL")

echo ""
echo "  Copy this value into your .env.local and Vercel environment variables:"
echo ""
echo -e "  ${GREEN}APP_CONFIG=${NC}"
echo ""
echo -e "${GREEN}${APP_CONFIG_JSON}${NC}"
echo ""

# Validate the JSON
python3 -c "
import json, sys
config = json.loads(sys.argv[1])
zones = config.get('zones', {})
hvac = config.get('hvacUnits', {})
delays = config.get('sensorDelays', {})
# Basic validation
errors = []
for zid, z in zones.items():
    for m in z.get('minisplits', []):
        if m not in hvac:
            errors.append(f'Zone {zid}: minisplit {m} not in hvacUnits')
    for s in z.get('exteriorOpenings', []):
        if s not in delays:
            errors.append(f'Zone {zid}: exterior sensor {s} not in sensorDelays')
    for d in z.get('interiorDoors', []):
        if d['id'] not in delays:
            errors.append(f'Zone {zid}: interior door {d[\"id\"]} not in sensorDelays')
        if d['connectsTo'] not in zones:
            errors.append(f'Zone {zid}: interior door connects to unknown zone {d[\"connectsTo\"]}')
if errors:
    for e in errors:
        print(f'  WARNING: {e}', file=sys.stderr)
else:
    print('  (JSON is valid, all references check out)')
" "$APP_CONFIG_JSON" 2>&1

pause

# ── Step 5: IFTTT Applet Instructions ─────────────────────────────────────────

header "Step 5: IFTTT Applet Instructions"

echo ""
echo "  Create the following applets at https://ifttt.com/create"

python3 -c "
import json, sys

zone_config = json.loads(sys.argv[1])
sensor_names = json.loads(sys.argv[2])
sensor_event_url = sys.argv[3]
hvac_event_url = sys.argv[4]
sensor_defaults = zone_config.get('sensorDefaults', {})
zones = zone_config['zones']
hvac_units = zone_config['hvacUnits']

YELLOW = '\033[1;33m'
GREEN = '\033[0;32m'
DIM = '\033[2m'
NC = '\033[0m'

def applet(name):
    print(f'\n{YELLOW}━━━ Applet: {name} ━━━{NC}')

# Collect all exterior sensor IDs across zones
exterior_sensors = set()
interior_doors = {}  # id -> {connectsTo list, installed}
for zid, z in zones.items():
    for sid in z.get('exteriorOpenings', []):
        exterior_sensors.add(sid)
    for door in z.get('interiorDoors', []):
        interior_doors[door['id']] = door

# 1. Exterior sensor applets
print(f'\n  {GREEN}── Exterior Sensor Applets ──{NC}')
for sid in sorted(exterior_sensors):
    sname = sensor_names.get(sid, sid)

    applet(f'{sname} Opened')
    print(f'  Trigger:  YoLink → Door Sensor → {sname} → Opens')
    print(f'  Action:   Webhooks → Make a web request')
    print(f'  URL:      {sensor_event_url}')
    print(f'  Method:   POST')
    print(f'  Content:  application/json')
    print(f'  Body:')
    print(f'  {GREEN}{{\"sensorId\":\"{sid}\",\"event\":\"open\"}}{NC}')

    applet(f'{sname} Closed')
    print(f'  Trigger:  YoLink → Door Sensor → {sname} → Closes')
    print(f'  Action:   Webhooks → Make a web request')
    print(f'  URL:      {sensor_event_url}')
    print(f'  Method:   POST')
    print(f'  Content:  application/json')
    print(f'  Body:')
    print(f'  {GREEN}{{\"sensorId\":\"{sid}\",\"event\":\"close\"}}{NC}')

# 2. Interior door sensor applets
if interior_doors:
    print(f'\n  {GREEN}── Interior Door Sensor Applets ──{NC}')
    shown = set()
    for did, door in sorted(interior_doors.items()):
        if did in shown:
            continue
        shown.add(did)
        dname = sensor_names.get(did, did)
        is_pending = did in sensor_defaults and sensor_defaults[did] == 'open'

        if is_pending:
            print(f'\n  {DIM}[pending hardware] {dname} — applets needed once sensor is installed{NC}')
            continue

        applet(f'{dname} Opened')
        print(f'  Trigger:  YoLink → Door Sensor → {dname} → Opens')
        print(f'  Action:   Webhooks → Make a web request')
        print(f'  URL:      {sensor_event_url}')
        print(f'  Method:   POST')
        print(f'  Content:  application/json')
        print(f'  Body:')
        print(f'  {GREEN}{{\"sensorId\":\"{did}\",\"event\":\"open\"}}{NC}')

        applet(f'{dname} Closed')
        print(f'  Trigger:  YoLink → Door Sensor → {dname} → Closes')
        print(f'  Action:   Webhooks → Make a web request')
        print(f'  URL:      {sensor_event_url}')
        print(f'  Method:   POST')
        print(f'  Content:  application/json')
        print(f'  Body:')
        print(f'  {GREEN}{{\"sensorId\":\"{did}\",\"event\":\"close\"}}{NC}')

# 3. HVAC turn-off applets
print(f'\n  {GREEN}── HVAC Turn-Off Applets ──{NC}')
for hid, unit in sorted(hvac_units.items()):
    applet(f'Turn Off {unit[\"name\"]}')
    print(f'  Trigger:  Webhooks → Receive a web request')
    print(f'  Event:    {unit[\"iftttEvent\"]}')
    print(f'  Action:   Cielo Home → Turn off → {unit[\"name\"]}')

# 4. HVAC power-on applets
print(f'\n  {GREEN}── HVAC Power-On Applets ──{NC}')
for hid, unit in sorted(hvac_units.items()):
    applet(f'{unit[\"name\"]} Turned On')
    print(f'  Trigger:  Cielo Home → Turned on → {unit[\"name\"]}')
    print(f'  Action:   Webhooks → Make a web request')
    print(f'  URL:      {hvac_event_url}')
    print(f'  Method:   POST')
    print(f'  Content:  application/json')
    print(f'  Body:')
    print(f'  {GREEN}{{\"hvacId\":\"{hid}\",\"event\":\"on\"}}{NC}')
" "$ZONE_CONFIG_JSON" "$SENSOR_NAME_MAP_JSON" "$SENSOR_EVENT_URL" "$HVAC_EVENT_URL"

pause

# ── Step 6: Summary Checklist ─────────────────────────────────────────────────

header "Step 6: Summary Checklist"

python3 -c "
import json, sys

zone_config = json.loads(sys.argv[1])
sensor_names = json.loads(sys.argv[2])
sensor_defaults = zone_config.get('sensorDefaults', {})
zones = zone_config['zones']
hvac_units = zone_config['hvacUnits']

DIM = '\033[2m'
NC = '\033[0m'

# Collect sensors
exterior_sensors = set()
interior_doors = {}
for zid, z in zones.items():
    for sid in z.get('exteriorOpenings', []):
        exterior_sensors.add(sid)
    for door in z.get('interiorDoors', []):
        interior_doors[door['id']] = door

num = 0

print('\n  Exterior sensor applets:')
for sid in sorted(exterior_sensors):
    sname = sensor_names.get(sid, sid)
    num += 1
    print(f'  {num}. [ ] {sname} → Opened → webhook POST')
    num += 1
    print(f'  {num}. [ ] {sname} → Closed → webhook POST')

if interior_doors:
    print('\n  Interior door sensor applets:')
    shown = set()
    for did in sorted(interior_doors):
        if did in shown:
            continue
        shown.add(did)
        dname = sensor_names.get(did, did)
        is_pending = did in sensor_defaults and sensor_defaults[did] == 'open'
        tag = f' {DIM}[pending]{NC}' if is_pending else ''
        num += 1
        print(f'  {num}. [ ] {dname} → Opened → webhook POST{tag}')
        num += 1
        print(f'  {num}. [ ] {dname} → Closed → webhook POST{tag}')

print('\n  HVAC turn-off applets:')
for hid, unit in sorted(hvac_units.items()):
    num += 1
    print(f'  {num}. [ ] Webhook → Turn off {unit[\"name\"]}')

print('\n  HVAC power-on applets:')
for hid, unit in sorted(hvac_units.items()):
    num += 1
    print(f'  {num}. [ ] {unit[\"name\"]} → Turned on → webhook POST')

print()
print('  After creating all applets, set APP_CONFIG in:')
print('    1. [ ] .env.local (for local testing)')
print('    2. [ ] Vercel environment variables (for production)')
print()
print(f'  Setup complete! You have {num} applets to create.')
" "$ZONE_CONFIG_JSON" "$SENSOR_NAME_MAP_JSON"

# ── Step 7: Save zone config ─────────────────────────────────────────────────

header "Step 7: Saving zone config"

python3 -c "
import json, sys
config = json.loads(sys.argv[1])
with open(sys.argv[2], 'w') as f:
    json.dump(config, f, indent=2)
print(f'  Saved to {sys.argv[2]}')
" "$ZONE_CONFIG_JSON" "$ZONE_CONFIG_FILE"

# Also save HVAC device names for backward compat
python3 -c "
import json, sys
config = json.loads(sys.argv[1])
names = [u['name'] for u in config['hvacUnits'].values()]
with open(sys.argv[2], 'w') as f:
    json.dump(names, f, indent=2)
" "$ZONE_CONFIG_JSON" "$HVAC_DEVICES_FILE"

echo "  Saved HVAC devices to $HVAC_DEVICES_FILE"
echo ""
echo -e "${GREEN}Done!${NC}"
