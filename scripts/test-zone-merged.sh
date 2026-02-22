#!/usr/bin/env bash
# Test: Interior doors open merge all zones.
# Front door opens → all units get timers.

BASE_URL="${BASE_URL:-https://your-app.vercel.app}"

echo "=== Test: Zone Merge (all doors open) ==="
echo ""

echo "1. Open main bedroom door (merge living + main bedroom)"
curl -s -X POST "$BASE_URL/api/sensor-event" \
  -H 'Content-Type: application/json' \
  -d '{"sensorId":"door_main_bedroom","event":"open"}' | jq .
echo ""

echo "2. Open back bedroom door (merge all zones)"
curl -s -X POST "$BASE_URL/api/sensor-event" \
  -H 'Content-Type: application/json' \
  -d '{"sensorId":"door_back_bedroom","event":"open"}' | jq .
echo ""

echo "3. Open front door — all zones exposed"
curl -s -X POST "$BASE_URL/api/sensor-event" \
  -H 'Content-Type: application/json' \
  -d '{"sensorId":"door_front","event":"open"}' | jq .
echo ""

echo "4. Check state"
curl -s "$BASE_URL/api/check-state" | jq .
echo ""
echo "=== Expected: All HVAC units get timers. ==="
