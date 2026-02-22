#!/usr/bin/env bash
# Test: Closing interior door cancels pending timer.
# 1. Open bedroom door (zones merge)
# 2. Open front door (all exposed, bedroom gets timer)
# 3. Close bedroom door (bedroom isolated, timer cancelled)

BASE_URL="${BASE_URL:-https://your-app.vercel.app}"

echo "=== Test: Door Close Cancellation ==="
echo ""

echo "1. Open main bedroom door (merge zones)"
curl -s -X POST "$BASE_URL/api/sensor-event" \
  -H 'Content-Type: application/json' \
  -d '{"sensorId":"door_main_bedroom","event":"open"}' | jq .
echo ""

echo "2. Open front door — living + main bedroom exposed"
curl -s -X POST "$BASE_URL/api/sensor-event" \
  -H 'Content-Type: application/json' \
  -d '{"sensorId":"door_front","event":"open"}' | jq .
echo ""

echo "3. Check state (bedroom timer should be active)"
curl -s "$BASE_URL/api/check-state" | jq .
echo ""

echo "4. Close main bedroom door — bedroom isolated, timer should cancel"
curl -s -X POST "$BASE_URL/api/sensor-event" \
  -H 'Content-Type: application/json' \
  -d '{"sensorId":"door_main_bedroom","event":"close"}' | jq .
echo ""

echo "5. Check state (bedroom timer should be gone)"
curl -s "$BASE_URL/api/check-state" | jq .
echo ""
echo "=== Expected: Bedroom AC timer cancelled. Living room timer remains. ==="
