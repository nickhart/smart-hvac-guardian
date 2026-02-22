#!/usr/bin/env bash
# Reset: Close all sensors to return system to baseline state.

BASE_URL="${BASE_URL:-https://your-app.vercel.app}"

echo "=== Reset: Closing all sensors ==="
echo ""

for sensor in door_front door_main_bedroom door_back_bedroom balcony_door bedroom_window back_window; do
  echo "Closing $sensor"
  curl -s -X POST "$BASE_URL/api/sensor-event" \
    -H 'Content-Type: application/json' \
    -d "{\"sensorId\":\"$sensor\",\"event\":\"close\"}" | jq .
  echo ""
done

echo "Check state after reset:"
curl -s "$BASE_URL/api/check-state" | jq .
echo ""
echo "=== All sensors closed. All timers should be cancelled. ==="
