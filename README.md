# Smart HVAC Guardian

An extensible webhook service that automatically turns off HVAC systems when doors or windows are left open, supporting YoLink sensors and Cielo controllers with configurable delays and easy IFTTT integration.

## How It Works

1. **IFTTT** sends a webhook to `POST /api/sensor-event` when a YoLink door/window sensor opens or closes
2. On "open" events, the server schedules a delayed check via **Upstash QStash**
3. After the delay, QStash calls `POST /api/check-state` which queries the **YoLink API** for current sensor state
4. If the sensor is still open, the server triggers **IFTTT webhooks** to turn off all configured HVAC units

## Setup

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/)
- A [Vercel](https://vercel.com) account (for deployment)
- [Upstash QStash](https://upstash.com/qstash) account
- [YoLink](https://www.yosmart.com/) account with API access
- [IFTTT](https://ifttt.com/) account with Webhooks service enabled

### Local Development

```bash
pnpm install
pnpm test        # run tests
pnpm type-check  # TypeScript validation
pnpm lint        # ESLint
```

### Environment Variables

Set these in your Vercel project (or `.env` file locally):

| Variable                     | Description                                    |
| ---------------------------- | ---------------------------------------------- |
| `APP_CONFIG`                 | JSON string with app configuration (see below) |
| `YOLINK_UA_CID`              | YoLink API UA Client ID                        |
| `YOLINK_SECRET_KEY`          | YoLink API Secret Key                          |
| `IFTTT_WEBHOOK_KEY`          | IFTTT Webhooks service key                     |
| `QSTASH_TOKEN`               | Upstash QStash token                           |
| `QSTASH_CURRENT_SIGNING_KEY` | QStash current signing key                     |
| `QSTASH_NEXT_SIGNING_KEY`    | QStash next signing key                        |

### APP_CONFIG Format

```json
{
  "sensors": [{ "id": "yolink-device-id", "name": "Front Door", "delaySeconds": 90 }],
  "hvacUnits": [{ "id": "unit1", "name": "Living Room AC", "iftttEvent": "turn_off_ac" }],
  "yolink": {
    "baseUrl": "https://api.yosmart.com/open/yolink/v2/api"
  },
  "checkStateUrl": "https://your-app.vercel.app/api/check-state"
}
```

### IFTTT Applet Setup

Create two IFTTT applets per sensor:

1. **Sensor Opens**: YoLink trigger (door open) → Webhooks action: `POST https://your-app.vercel.app/api/sensor-event` with JSON body `{"sensorId":"your-sensor-id","event":"open"}`
2. **Sensor Closes**: YoLink trigger (door close) → Webhooks action: `POST https://your-app.vercel.app/api/sensor-event` with JSON body `{"sensorId":"your-sensor-id","event":"close"}`

Create one IFTTT applet per HVAC unit:

3. **Turn Off HVAC**: Webhooks trigger (event name matching `iftttEvent` in config) → Cielo/smart AC action to turn off

### Deploy

```bash
vercel deploy
```

## API Endpoints

### `POST /api/sensor-event`

Receives sensor open/close events from IFTTT.

**Body:** `{ "sensorId": "string", "event": "open" | "close" }`

### `POST /api/check-state`

Called by QStash after the configured delay. Verifies QStash signature, checks sensor state, and turns off HVAC if still open.

**Body:** `{ "sensorId": "string" }` (sent by QStash)
