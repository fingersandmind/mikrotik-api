# Postman Setup Guide

## 1. Create a New Collection

1. Open Postman
2. Click **New → Collection**
3. Name it `MikroTik API`

## 2. Set Up Collection Variables

Go to your collection → **Variables** tab and add:

| Variable   | Initial Value              |
|------------|----------------------------|
| `base_url` | `http://localhost:3000/api` |
| `api_key`  | `your-secret-api-key-here`  |

Click **Save**.

## 3. Set Up Collection Auth

Go to your collection → **Authorization** tab:

1. Type: **API Key**
2. Key: `X-API-Key`
3. Value: `{{api_key}}`
4. Add to: **Header**

Click **Save**. All requests in this collection will inherit this header automatically.

---

## Endpoints

### Health Check

Check if the API server can reach the MikroTik router.

- **Method:** `GET`
- **URL:** `{{base_url}}/health`
- **Auth:** Inherited from collection
- **Body:** None

**Example Response:**
```json
{
  "status": "ok",
  "router": "CCR1036 Wireless PPPoE / HS/PTP - TUBIGON"
}
```

---

### List Profiles

Get all PPPoE profiles configured on the router.

- **Method:** `GET`
- **URL:** `{{base_url}}/profiles`
- **Auth:** Inherited from collection
- **Body:** None

**Example Response:**
```json
[
  {
    "name": "UNPAID",
    "localAddress": "172.16.255.1",
    "remoteAddress": "expired",
    "rateLimit": ""
  },
  {
    "name": "*10MB",
    "localAddress": "100.111.0.1",
    "remoteAddress": "10MB",
    "rateLimit": ""
  }
]
```

---

### List Active Sessions

Get all currently connected PPPoE subscribers.

- **Method:** `GET`
- **URL:** `{{base_url}}/active`
- **Auth:** Inherited from collection
- **Body:** None

**Example Response:**
```json
[
  {
    "id": "*800007DB",
    "name": "cuaming.rap2x@pppoe",
    "address": "100.111.0.177",
    "uptime": "1d20h33m15s",
    "callerID": "AC:B3:B5:DA:E1:BF"
  }
]
```

---

### Disconnect Subscriber

Disable a subscriber's PPPoE secret and kill their active session. Optionally change their profile (e.g., to `UNPAID`).

- **Method:** `POST`
- **URL:** `{{base_url}}/disconnect`
- **Auth:** Inherited from collection
- **Body:** raw → JSON

**Body (basic):**
```json
{
  "pppoe_username": "cuaming.rap2x@pppoe"
}
```

**Body (with profile change):**
```json
{
  "pppoe_username": "cuaming.rap2x@pppoe",
  "profile": "UNPAID"
}
```

**Example Response:**
```json
{
  "status": "disconnected",
  "username": "cuaming.rap2x@pppoe",
  "profile": "UNPAID"
}
```

---

### Reconnect Subscriber

Re-enable a subscriber's PPPoE secret. Optionally restore their profile. The subscriber's device will auto-reconnect via PPPoE retry.

- **Method:** `POST`
- **URL:** `{{base_url}}/reconnect`
- **Auth:** Inherited from collection
- **Body:** raw → JSON

**Body (basic):**
```json
{
  "pppoe_username": "cuaming.rap2x@pppoe"
}
```

**Body (with profile change):**
```json
{
  "pppoe_username": "cuaming.rap2x@pppoe",
  "profile": "*10MB"
}
```

**Example Response:**
```json
{
  "status": "reconnected",
  "username": "cuaming.rap2x@pppoe",
  "profile": "*10MB"
}
```

---

### Batch Disconnect

Disconnect multiple subscribers at once (max 100). Optionally set all to a profile.

- **Method:** `POST`
- **URL:** `{{base_url}}/batch/disconnect`
- **Auth:** Inherited from collection
- **Body:** raw → JSON

```json
{
  "pppoe_usernames": [
    "cuaming.rap2x@pppoe",
    "cuaming.diane@pppoe",
    "cuaming.ivy1@pppoe"
  ]
}
```

**Example Response:**
```json
{
  "total": 3,
  "succeeded": 3,
  "failed": 0,
  "results": [
    { "status": "disconnected", "username": "cuaming.rap2x@pppoe" },
    { "status": "disconnected", "username": "cuaming.diane@pppoe" },
    { "status": "disconnected", "username": "cuaming.ivy1@pppoe" }
  ]
}
```

---

### Batch Reconnect

Reconnect multiple subscribers at once (max 100).

- **Method:** `POST`
- **URL:** `{{base_url}}/batch/reconnect`
- **Auth:** Inherited from collection
- **Body:** raw → JSON

```json
{
  "pppoe_usernames": [
    "cuaming.rap2x@pppoe",
    "cuaming.diane@pppoe",
    "cuaming.ivy1@pppoe"
  ]
}
```

**Example Response:**
```json
{
  "total": 3,
  "succeeded": 3,
  "failed": 0,
  "results": [
    { "status": "reconnected", "username": "cuaming.rap2x@pppoe" },
    { "status": "reconnected", "username": "cuaming.diane@pppoe" },
    { "status": "reconnected", "username": "cuaming.ivy1@pppoe" }
  ]
}
```

---

## Typical Workflow

1. **Check connection** → `GET /api/health`
2. **List profiles** → `GET /api/profiles` to see available plans
3. **List active users** → `GET /api/active` to see who's online
4. **Disconnect unpaid user** → `POST /api/disconnect` with `profile: "UNPAID"`
5. **Reconnect after payment** → `POST /api/reconnect` with `profile: "*10MB"` (or their plan)

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `403 Forbidden` | IP not whitelisted | Add your IP to `ALLOWED_IPS` in `.env` |
| `401 Unauthorized` | Missing or wrong API key | Add `X-API-Key` header with correct key |
| `500 PPPoE secret not found` | Username doesn't exist on router | Check the exact username in `/api/active` |
| `503 Service Unavailable` | Can't reach MikroTik router | Check `MIKROTIK_HOST` and that API port 8728 is enabled |
