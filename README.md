# MikroTik API Server

Local API server that communicates with MikroTik RouterOS. Designed to run on-site at your ISP network and be called from a remote billing application (e.g., hosted on Digital Ocean).

## Architecture

```
[Digital Ocean]              Internet              [Your Local Network]
 Laravel App  ──────────────────────────────►  This API Server
 (Billing)     via Cloudflare Tunnel / ngrok        │
                                               LAN (192.168.88.x)
                                                    │
                                               MikroTik Router
                                              (192.168.88.1:8728)
```

## Prerequisites

- Node.js 18+
- A machine on the same local network as your MikroTik router
- MikroTik RouterOS API enabled (port 8728)

## Setup

### 1. Get your MikroTik connection details

You need two values from the MikroTik router — ask your client or check WinBox:

**Host (Router IP):**
- This is the same IP address used to connect to WinBox
- In WinBox, go to **IP > Addresses** to see the router's LAN IP
- Typically something like `192.168.88.1`

**Port (API Port):**
- In WinBox, go to **IP > Services** — look for the `api` service
- Default is **8728**

These go into your `.env` file as `MIKROTIK_HOST` and `MIKROTIK_PORT`.

> **Note:** Since this server runs on the same local network as the router, you use the router's local/LAN IP — not a public IP.

### 2. Enable RouterOS API on MikroTik

Open WinBox and go to **IP > Services**. Make sure the `api` service is enabled:

| Service | Port | Enabled |
|---------|------|---------|
| api     | 8728 | Yes     |

For security, set **"Available From"** to only the IP of the machine running this server.

Alternatively, via terminal:

```
/ip service enable api
/ip service set api address=192.168.88.100/32
```

*(Replace `192.168.88.100` with the local IP of the machine running this server)*

### 3. Create a dedicated API user on MikroTik

Don't use the admin account. Create a limited user via WinBox or terminal:

```
/user group add name=api-access policy=read,write,api,test
/user add name=billing-api password=strong-password-here group=api-access
```

### 4. Install and configure

```bash
git clone <your-repo-url>
cd mikrotik-api
npm install
cp .env.example .env
```

Edit `.env`:

```
PORT=3000
API_KEY=generate-a-strong-key-here
ALLOWED_IPS=123.45.67.89
MIKROTIK_HOST=192.168.88.1
MIKROTIK_PORT=8728
MIKROTIK_USER=billing-api
MIKROTIK_PASSWORD=strong-password-here
```

- **API_KEY** — shared secret between this server and your Laravel app
- **ALLOWED_IPS** — your Digital Ocean droplet's public IP (comma-separated for multiple)

To generate an API key:

```bash
openssl rand -hex 32
```

To find your DO droplet's IP:

```bash
# Run this on your Digital Ocean server
curl ifconfig.me
```

### 5. Test the connection

```bash
npm run dev
```

Test health check:

```bash
curl http://localhost:3000/api/health
```

Expected response:

```json
{ "status": "ok", "router": "YourRouterName" }
```

### 6. Run in production

Use [PM2](https://pm2.io/) to keep the server running:

```bash
npm install -g pm2
pm2 start src/index.js --name mikrotik-api
pm2 save
pm2 startup
```

This ensures the server auto-restarts on crash or reboot.

## Exposing to the Internet via Cloudflare Tunnel

The billing app on Digital Ocean needs to reach this local server. Cloudflare Tunnel creates a secure outbound connection from the local machine to Cloudflare — no open ports, no static IP needed, free tier.

```
[DO Laravel App] → HTTPS → [Cloudflare Edge] → Tunnel → [Local Machine:3000]
```

### Prerequisites

- A Cloudflare account (free)
- A domain added to Cloudflare (DNS managed by Cloudflare)

### Step 1: Install cloudflared

**Linux (Debian/Ubuntu):**
```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
```

**Linux (Other):**
```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
```

**macOS:**
```bash
brew install cloudflared
```

Verify installation:
```bash
cloudflared --version
```

### Step 2: Authenticate with Cloudflare

```bash
cloudflared tunnel login
```

This opens a browser. Select the domain you want to use and authorize it. A certificate is saved to `~/.cloudflared/cert.pem`.

### Step 3: Create the tunnel

```bash
cloudflared tunnel create mikrotik-api
```

This outputs a **Tunnel ID** (a UUID like `a1b2c3d4-...`). Save it — you'll need it next.

### Step 4: Create the config file

```bash
mkdir -p ~/.cloudflared
```

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: /home/YOUR_USER/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: mikrotik-api.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

Replace:
- `YOUR_TUNNEL_ID` — the UUID from Step 3
- `YOUR_USER` — your Linux username
- `mikrotik-api.yourdomain.com` — the subdomain you want to use

### Step 5: Create DNS record

```bash
cloudflared tunnel route dns mikrotik-api mikrotik-api.yourdomain.com
```

This automatically creates a CNAME record in Cloudflare DNS pointing to your tunnel.

### Step 6: Test the tunnel

```bash
# Start the API server
npm start &

# Start the tunnel
cloudflared tunnel run mikrotik-api
```

From another machine (or your DO droplet), test it:

```bash
curl https://mikrotik-api.yourdomain.com/api/health
```

If you see `{ "status": "ok", "router": "YourRouterName" }`, it's working.

### Step 7: Run tunnel as a system service

So it starts automatically on boot:

```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

Check status:
```bash
sudo systemctl status cloudflared
```

### Full production startup order

Both the API server and the tunnel need to run on boot:

```bash
# 1. API server via PM2 (from earlier setup)
pm2 start src/index.js --name mikrotik-api
pm2 save
pm2 startup

# 2. Cloudflare Tunnel via systemd
sudo cloudflared service install
sudo systemctl enable cloudflared
```

### Laravel .env configuration

Once the tunnel is running, add to your Laravel app's `.env` on Digital Ocean:

```
MIKROTIK_API_URL=https://mikrotik-api.yourdomain.com
MIKROTIK_API_KEY=your-api-key-here
```

### Optional: Add Cloudflare Access (extra security)

For an additional authentication layer at the Cloudflare edge (before traffic even reaches your server):

1. Go to **Cloudflare Dashboard > Zero Trust > Access > Applications**
2. Click **Add an application > Self-hosted**
3. Set the domain to `mikrotik-api.yourdomain.com`
4. Add a **Service Auth** policy with a **Service Token**
5. Generate the service token and add the headers to your Laravel HTTP calls:

```php
Http::withHeaders([
    'X-API-Key' => config('services.mikrotik.key'),
    'CF-Access-Client-Id' => config('services.mikrotik.cf_client_id'),
    'CF-Access-Client-Secret' => config('services.mikrotik.cf_client_secret'),
])->post(config('services.mikrotik.url') . '/api/disconnect', [
    'pppoe_username' => $pppoeUsername,
]);
```

This gives you three layers: Cloudflare Access → IP Whitelist → API Key.

## API Endpoints

All endpoints except health require the `X-API-Key` header.

### Health Check

```
GET /api/health
```

Response: `{ "status": "ok", "router": "RouterName" }`

### Disconnect Subscriber

```bash
curl -X POST http://localhost:3000/api/disconnect \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"pppoe_username": "subscriber001"}'
```

Response: `{ "status": "disconnected", "username": "subscriber001" }`

This disables the PPPoE secret and removes any active session.

### Reconnect Subscriber

```bash
curl -X POST http://localhost:3000/api/reconnect \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"pppoe_username": "subscriber001"}'
```

Response: `{ "status": "reconnected", "username": "subscriber001" }`

This re-enables the PPPoE secret. The subscriber's device will auto-reconnect.

### List Active Sessions

```bash
curl http://localhost:3000/api/active \
  -H "X-API-Key: your-api-key"
```

Response:

```json
[
  {
    "id": "*1",
    "name": "subscriber001",
    "address": "10.0.0.2",
    "uptime": "3h24m",
    "callerID": "AA:BB:CC:DD:EE:FF"
  }
]
```

## Calling from Laravel

Add to your Laravel `config/services.php`:

```php
'mikrotik' => [
    'url' => env('MIKROTIK_API_URL'),
    'key' => env('MIKROTIK_API_KEY'),
],
```

Example usage:

```php
use Illuminate\Support\Facades\Http;

$response = Http::withHeaders([
    'X-API-Key' => config('services.mikrotik.key'),
])->post(config('services.mikrotik.url') . '/api/disconnect', [
    'pppoe_username' => $subscription->pppoe_name,
]);

if ($response->successful()) {
    // Subscriber disconnected
}
```

## Security

This server has multiple layers of protection:

| Layer | What it does |
|-------|-------------|
| **IP Whitelist** | Only your DO droplet's IP can reach the server. All other IPs get `403 Forbidden`. |
| **API Key** | Every request (except health check) must include a valid `X-API-Key` header. |
| **Rate Limiting** | Max 30 requests per minute per IP to prevent abuse. |
| **Timing-Safe Auth** | API key comparison uses `crypto.timingSafeEqual` to prevent timing attacks. |
| **Helmet** | Sets secure HTTP headers (no MIME sniffing, XSS protection, etc.). |
| **Request Logging** | All requests are logged with IP, method, path, status, and duration. |
| **JSON Size Limit** | Request body limited to 10KB to prevent payload abuse. |
| **No Fingerprinting** | `X-Powered-By` header is disabled. |
| **Catch-All 404** | Unknown routes return 404 — no information leakage. |

**Production checklist:**
- [ ] Set `ALLOWED_IPS` to your DO droplet's IP
- [ ] Generate a strong `API_KEY` with `openssl rand -hex 32`
- [ ] Create a dedicated MikroTik user (don't use admin)
- [ ] Use Cloudflare Tunnel or restrict firewall to DO IP only
- [ ] Use HTTPS if exposing directly (not needed with Cloudflare Tunnel)

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Health check returns `"status": "error"` | Verify `MIKROTIK_HOST` and `MIKROTIK_PORT` in `.env`. Ensure the API service is enabled on the router. |
| `Connection refused` | The RouterOS API service may be disabled or the port is wrong. Check **IP > Services** in WinBox. |
| `Cannot connect` | Make sure this server is on the same LAN as the MikroTik. Check firewall rules. |
| `PPPoE secret not found` | The `pppoe_username` doesn't match any secret on the router. Verify the name in **PPP > Secrets**. |
| `Login failure` | Wrong credentials in `.env`. Verify the user exists and has API access on the router. |
| `403 Forbidden` | Your IP is not in `ALLOWED_IPS`. Check your DO droplet's public IP with `curl ifconfig.me`. |
| `429 Too Many Requests` | Rate limit hit. Wait a minute or increase the limit in `src/index.js`. |
