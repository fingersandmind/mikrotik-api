# MikroTik Setup Request for Client

Hi! We're setting up an integration between our billing system and your MikroTik router so we can automatically disconnect and reconnect subscribers based on their payment status.

To get this working, I need you to do a few things on the MikroTik side. Everything is done through WinBox.

---

## 1. Enable the RouterOS API

We need the API service enabled so our server can communicate with the router.

**In WinBox:**
1. Go to **IP > Services**
2. Find `api` (port 8728) and make sure it's **enabled**
3. Optionally, set "Available From" to restrict which devices can connect (I'll give you the IP once the local server is set up)

**Or via terminal:**
```
/ip service enable api
```

---

## 2. Create a dedicated API user

For security, we don't want to use the admin account. Please create a new user specifically for this integration.

**In WinBox:**
1. Go to **System > Users**
2. Click the **Groups** tab and add a new group:
   - **Name:** `api-access`
   - **Policies:** check `read`, `write`, `api`, `test` — uncheck everything else
3. Go back to the **Users** tab and add a new user:
   - **Name:** `billing-api`
   - **Group:** `api-access`
   - **Password:** (choose a strong password and share it with me securely)

**Or via terminal:**
```
/user group add name=api-access policy=read,write,api,test
/user add name=billing-api password=YOUR_PASSWORD group=api-access
```

---

## 3. Create a test PPPoE secret

For testing, I need a dummy PPPoE account that I can safely disconnect and reconnect without affecting real subscribers.

**In WinBox:**
1. Go to **PPP > Secrets**
2. Click **Add (+)**
3. Fill in:
   - **Name:** `test-subscriber`
   - **Password:** `test123`
   - **Service:** `pppoe`
   - **Profile:** (use any existing profile)
4. Click **OK**

---

## What I need from you

Once you've completed the steps above, please send me the following:

| Item | Example | Your Value |
|------|---------|------------|
| Router IP address | `192.168.88.1` | |
| API port | `8728` (default) | |
| API username | `billing-api` | |
| API password | (the one you set) | |
| Test PPPoE secret name | `test-subscriber` | |

> **How to find the Router IP:** This is the same IP address you type into WinBox to connect to the router. You can also check it in **IP > Addresses**.

> **How to find the API port:** Go to **IP > Services** and look at the port number next to `api`. Default is 8728.

---

## Security notes

- The API user has limited permissions — it can only manage PPP sessions, not change router settings
- We will restrict API access to only our server's IP address
- All communication between our billing system and the local server is authenticated with an API key
- No router ports will be exposed to the internet

---

## Questions?

If anything is unclear or you need help with any of these steps, just let me know!
