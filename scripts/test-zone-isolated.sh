#!/usr/bin/env bash
# Test: Interior doors closed isolate bedrooms.
# Front door opens → only living room + loft exposed.
# Main bedroom and back bedroom stay safe.

BASE_URL="${BASE_URL:-https://your-app.vercel.app}"

echo "=== Test: Zone Isolation ==="
echo ""

echo "1. Close main bedroom door (isolate main bedroom)"
curl -s -X POST "$BASE_URL/api/sensor-event" \
  -H 'Content-Type: application/json' \
  -d '{"sensorId":"door_main_bedroom","event":"close"}' | jq .
echo ""

echo "2. Close back bedroom door (isolate back bedroom)"
curl -s -X POST "$BASE_URL/api/sensor-event" \
  -H 'Content-Type: application/json' \
  -d '{"sensorId":"door_back_bedroom","event":"close"}' | jq .
echo ""

echo "3. Open front door — only living room zone exposed"
curl -s -X POST "$BASE_URL/api/sensor-event" \
  -H 'Content-Type: application/json' \
  -d '{"sensorId":"door_front","event":"open"}' | jq .
echo ""

echo "4. Check state"
curl -s "$BASE_URL/api/check-state" | jq .
echo ""
echo "=== Expected: Only living room AC gets a timer. Bedrooms are safe. ==="
