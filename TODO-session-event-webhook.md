# TODO: MikroTik Session Event Webhook (on-down / on-up)

Detect when a PPPoE client disconnects (or reconnects) using MikroTik's PPP profile scripts, and notify the Laravel billing system (kazibufastnet) in real time.

## Architecture

```
MikroTik Router (PPP profile on-down/on-up script)
    → kazibufastnet Laravel app (POST /webhooks/mikrotik)
        → Resolve subscription by pppoe_name + router token
        → Log event, notify client, trigger business logic
```

Each MikroTik router gets a unique `webhook_token` stored in the `mikrotik_routers` table. The router includes this token in its HTTP call so kazibufastnet can identify which router (and therefore which branch) sent the event.

---

## Phase 1: Database — Add webhook_token to mikrotik_routers

**Project:** `kazibufastnet` (`/Users/jmal/projects/kazibufastnet`)

- [ ] **Create migration:** `add_webhook_token_to_mikrotik_routers_table`
  - Add `webhook_token` column (`string`, unique, nullable)
  - Generate a token for each existing router using `Str::random(64)`
  - Reference: existing migrations at `database/migrations/2026_03_16_104810_create_mikrotik_routers_table.php`

- [ ] **Update MikrotikRouter model** (`app/Models/MikrotikRouter.php`)
  - Add `webhook_token` to `$fillable`
  - Add a `boot()` method or observer to auto-generate token on creation: `static::creating(fn ($r) => $r->webhook_token ??= Str::random(64))`
  - Add a `regenerateWebhookToken()` method

- [ ] **Update MikrotikRouter admin UI** (if applicable)
  - Display the webhook token (read-only, copyable) so admins can configure the router script
  - Add a "Regenerate Token" button
  - Show the full webhook URL for easy copy-paste: `{APP_URL}/webhooks/mikrotik?token={webhook_token}`

---

## Phase 2: Webhook Endpoint in kazibufastnet

**Project:** `kazibufastnet` (`/Users/jmal/projects/kazibufastnet`)

### Route

- [ ] **Add route** in `routes/web.php` (public, no auth — like existing webhook routes at line ~429)
  ```php
  Route::post('/webhooks/mikrotik', [MikrotikWebhookController::class, 'handle']);
  ```
  - Place alongside existing webhook routes (`/webhooks/tpzan`, `/xendit/webhook`, etc.)
  - Exclude from CSRF verification in `VerifyCsrfToken` middleware (if not already excluded for `/webhooks/*`)

### Controller

- [ ] **Create `MikrotikWebhookController`** (`app/Http/Controllers/MikrotikWebhookController.php`)
  - Follow the pattern from `TpzanWebhookController` (`app/Http/Controllers/TpzanWebhookController.php`)
  - Method: `handle(Request $request): JsonResponse`
  - Validation:
    - Required fields: `token`, `user` (PPPoE username), `event` (up/down)
    - Optional fields: `caller-id` (MAC address), `address` (IP)
  - Token verification:
    ```php
    $router = MikrotikRouter::where('webhook_token', $request->input('token'))->first();
    if (!$router) return response()->json(['error' => 'Invalid token'], 401);
    ```
  - Resolve subscription:
    - Find branch(es) via `$router->branches`
    - Find subscription via `JobOrder` where `pppoe_name` = `$request->input('user')` and `branch_id` in router's branches
    - If not found, log and return 200 (don't error — could be a secret not managed by the billing system)
  - Dispatch `ProcessMikrotikSessionEvent` job with: `subscription_id`, `router_id`, `event` (up/down), `caller_id`, `address`
  - Return `{'status': 'ok'}` immediately (processing is async)

### Job

- [ ] **Create `ProcessMikrotikSessionEvent` job** (`app/Jobs/ProcessMikrotikSessionEvent.php`)
  - Follow the pattern from `MikrotikDisconnectJob` (`app/Jobs/MikrotikDisconnectJob.php`)
  - `implements ShouldQueue`, `use Dispatchable, InteractsWithQueue, Queueable, SerializesModels`
  - `$tries = 3`
  - Constructor params: `int $subscriptionId`, `int $routerId`, `string $event`, `?string $callerId`, `?string $address`
  - `handle()` method:
    - Load subscription with `user`, `plan`, `job_order`, `branch` relations
    - **On `down` event:**
      - Log to `DataHistory` (type: `'session_event'`, description: `'PPPoE session down for {pppoe_name}'`)
      - Create `ClientNotification` via `NotificationService->notify()` (type: `'service'`, title: `'Connection Lost'`, message with details)
      - Optionally send SMS via `SendSmsJob` (configurable per branch — see Phase 4)
    - **On `up` event:**
      - Log to `DataHistory`
      - Optionally notify (may want to skip to avoid notification spam)

### Event Log Table (optional but recommended)

- [ ] **Create migration:** `create_session_events_table`
  ```
  id, subscription_id, router_id, event (up/down), pppoe_username,
  caller_id, address, payload (json), created_at
  ```
  - Lightweight log of all raw session events for debugging and analytics
  - Can be used to track uptime/downtime history per subscription

- [ ] **Create `SessionEvent` model** (`app/Models/SessionEvent.php`)
  - Relationships: `subscription()`, `router()`
  - Scope: `BranchScope` via branch on subscription

---

## Phase 3: MikroTik Router Configuration

**Where:** On each MikroTik router via Winbox/terminal

### PPP Profile on-down script

- [ ] **Add `on-down` script** to each PPP profile that should be monitored:
  ```routeros
  /ppp profile set [find name="PROFILE_NAME"] \
    on-down="/tool fetch url=\"https://your-app-domain.com/webhooks/mikrotik\" \
      http-method=post \
      http-data=\"token=ROUTER_WEBHOOK_TOKEN&user=\$user&event=down&caller-id=\$\\\"caller-id\\\"&address=\$address\" \
      keep-result=no"
  ```

### PPP Profile on-up script (optional)

- [ ] **Add `on-up` script** for reconnect detection:
  ```routeros
  /ppp profile set [find name="PROFILE_NAME"] \
    on-up="/tool fetch url=\"https://your-app-domain.com/webhooks/mikrotik\" \
      http-method=post \
      http-data=\"token=ROUTER_WEBHOOK_TOKEN&user=\$user&event=up&caller-id=\$\\\"caller-id\\\"&address=\$address\" \
      keep-result=no"
  ```

### Important notes

- [ ] The MikroTik must be able to reach the kazibufastnet URL (via Cloudflare Tunnel or direct)
- [ ] `/tool fetch` runs asynchronously on RouterOS — it won't block the PPP session teardown
- [ ] Test with a single profile first before rolling out to all profiles
- [ ] Variables available in PPP scripts: `$user`, `$caller-id`, `$address`, `$remote-address`
- [ ] If the app is behind HTTPS (Cloudflare), ensure the router can resolve DNS and do TLS (RouterOS v6.45+ supports SNI)

---

## Phase 4: Configuration & Settings

**Project:** `kazibufastnet`

- [ ] **Add branch-level settings** (via existing `system_settings` or similar):
  - `session_event_notifications_enabled` (bool, default: true)
  - `notify_on_session_down` (bool, default: true) — in-app notification
  - `sms_on_session_down` (bool, default: false) — SMS notification
  - `notify_on_session_up` (bool, default: false)
  - `session_down_cooldown_minutes` (int, default: 5) — prevent notification spam for flapping connections

- [ ] **Cooldown logic in the job:**
  - Before notifying, check if there was a recent `down` event for this subscription within the cooldown window
  - Skip notification if within cooldown (still log the event)
  - This prevents spam when a client's connection is flapping (up/down/up/down)

---

## Phase 5: Testing & Rollout

- [ ] **Unit test** the webhook controller (invalid token, missing fields, valid event)
- [ ] **Test with one router** — set up on-down on a test profile, disconnect a client, verify:
  - Webhook received and 200 returned
  - Job dispatched and processed
  - SessionEvent logged
  - DataHistory entry created
  - ClientNotification created (if enabled)
- [ ] **Monitor** `/tool fetch` on MikroTik — check for HTTP errors in router logs
- [ ] **Roll out** to remaining routers/profiles once verified
- [ ] **Dashboard** (future) — session event history view per subscription

---

## File Reference (kazibufastnet)

| File | Purpose |
|------|---------|
| `app/Models/MikrotikRouter.php` | Router model — add `webhook_token` |
| `app/Models/Subscription.php` | Subscription model — lookup target |
| `app/Models/JobOrder.php` | Has `pppoe_name` for matching |
| `app/Models/DataHistory.php` | Audit logging pattern |
| `app/Models/ClientNotification.php` | In-app notification model |
| `app/Services/MikrotikApiService.php` | Router resolution logic (`routerForSubscription()`) |
| `app/Services/NotificationService.php` | `notify()` and `notifyBulk()` methods |
| `app/Services/SmsService.php` | SMS via M360 — `send()` method |
| `app/Jobs/MikrotikDisconnectJob.php` | Job pattern reference (3 retries, queue-based) |
| `app/Jobs/SendSmsJob.php` | SMS job pattern reference |
| `app/Http/Controllers/TpzanWebhookController.php` | Webhook controller pattern (token verification, async dispatch) |
| `routes/web.php` | Webhook routes at ~line 429 |
| `config/mikrotik.php` | MikroTik API config |

---

## Notes

- **No changes needed in mikrotik-api** (this Node.js project) — the router calls kazibufastnet directly
- **CSRF exclusion** — ensure `/webhooks/mikrotik` is excluded from CSRF middleware
- **Rate limiting** — consider adding rate limiting to the webhook endpoint to prevent abuse (e.g., 60 requests/minute per token)
- **Idempotency** — the same event arriving twice should not create duplicate notifications (use the cooldown + check for recent identical events)
