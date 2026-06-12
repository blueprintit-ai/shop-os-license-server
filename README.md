---
type: project
status: ready-to-deploy
project: shop-os
tags: [license-server, cloudflare-worker, shop-os, infrastructure]
---

# Shop OS License Server

A small Cloudflare Worker that issues, validates, and revokes Shop OS license keys. Backed by Cloudflare KV. Free tier handles 100,000 reads/day, way more than we will use for years.

## What it does

- **`GET /validate?key=...`**: used by the npx installer when a customer pastes their key. Returns customer info + entitlements if the key is valid.
- **`GET /refresh?key=...`**: used by Shop OS skills periodically to confirm the license is still active. Bumps `last_seen` and returns the same shape as `/validate`.
- **`POST /issue`**: admin endpoint. Generates a new key when a customer pays. Called from a Stripe webhook later, or manually via `scripts/issue-license.sh`.
- **`POST /revoke?key=...`**: admin endpoint. Marks a key as cancelled. Subsequent `/validate` calls return 403.
- **`GET /list`**: admin endpoint. Returns all licenses (paginated up to 1000).

## One-time setup (about 30 minutes)

You will do this once. After that, issuing license keys is a single shell command.

### 1. Install Node.js and Wrangler

```sh
# Install Node 18+ if you do not have it. Either:
brew install node            # macOS
# or download from nodejs.org

# Install Wrangler globally
npm install -g wrangler
wrangler --version           # confirm install
```

### 2. Create a Cloudflare account

Go to [dash.cloudflare.com](https://dash.cloudflare.com) and sign up. Free tier is enough.

### 3. Authenticate Wrangler

```sh
wrangler login
```

A browser window opens. Authorize Wrangler to access your Cloudflare account. Close the browser when done.

### 4. Create the KV namespace

This is the storage backend for license records.

```sh
cd "Projects/shop-os-license-server"

# Install local dev dependencies first.
npm install

# Create the KV namespace.
wrangler kv:namespace create LICENSES
```

Wrangler will print something like:

```
🌀 Creating namespace with title "shop-os-license-server-LICENSES"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "LICENSES", id = "abc123def456..." }
```

Copy the `id` value.

### 5. Paste the KV id into `wrangler.toml`

Open `wrangler.toml`. Find this section:

```toml
[[kv_namespaces]]
binding = "LICENSES"
id = "YOUR_KV_NAMESPACE_ID"
```

Replace `YOUR_KV_NAMESPACE_ID` with the id from step 4.

### 6. Set the admin token

This is the bearer token that protects the `/issue`, `/revoke`, and `/list` endpoints. Pick a long random string. **Only you know it.**

```sh
# Generate a random token
openssl rand -hex 32
# Output example: 5a8b3c2d... (32 bytes = 64 hex chars)

# Save it as a Cloudflare secret (not committed to git)
wrangler secret put ADMIN_TOKEN
# Paste the value when prompted
```

### 7. Deploy

```sh
wrangler deploy
```

You will see something like:

```
Uploaded shop-os-license-server (1.23 sec)
Published shop-os-license-server (4.56 sec)
  https://shop-os-license-server.YOUR-SUBDOMAIN.workers.dev
```

Copy that URL. That is your Worker endpoint.

### 8. Smoke test

```sh
# Health check (public, no auth)
curl https://shop-os-license-server.YOUR-SUBDOMAIN.workers.dev/
# {"name":"shop-os-license-server","version":"1.0.0","ok":true}

# Try issuing a license (requires the ADMIN_TOKEN you just set)
curl -X POST https://shop-os-license-server.YOUR-SUBDOMAIN.workers.dev/issue \
  -H "authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"customer":"Test Shop","email":"test@example.com"}'
# {"ok":true,"license":{"key":"SHOP-XXXX-YYYY-ZZZZ", ...}}

# Validate that key
curl "https://shop-os-license-server.YOUR-SUBDOMAIN.workers.dev/validate?key=SHOP-XXXX-YYYY-ZZZZ"
# {"valid":true,"customer":"Test Shop","product":"shop-os-foundation","entitlements":["foundation"], ...}

# Revoke it
curl -X POST "https://shop-os-license-server.YOUR-SUBDOMAIN.workers.dev/revoke?key=SHOP-XXXX-YYYY-ZZZZ" \
  -H "authorization: Bearer YOUR_ADMIN_TOKEN"
# {"ok":true, ...}
```

Done. License server is live.

## Daily workflow

After setup, issuing a license is one command. First, export your env vars (do this once per terminal session, or put in `~/.zshrc`):

```sh
export WORKER_URL='https://shop-os-license-server.YOUR-SUBDOMAIN.workers.dev'
export ADMIN_TOKEN='your-admin-token-from-step-6'
```

Then:

```sh
# Issue a key for a paying customer
./scripts/issue-license.sh "Acme Cabinets" "owner@acmecabinets.com"

# Output:
# {
#   "ok": true,
#   "license": {
#     "key": "SHOP-XXXX-YYYY-ZZZZ",
#     "customer": "Acme Cabinets",
#     ...
#   }
# }

# Revoke a key when a customer cancels
./scripts/revoke-license.sh SHOP-XXXX-YYYY-ZZZZ
```

Email the key to the customer in the Shop OS welcome email. The npx installer they run will validate it against this server.

## License record schema

Each license is stored in KV as JSON, keyed by the license key string:

```json
{
  "key": "SHOP-XXXX-YYYY-ZZZZ",
  "customer": "Acme Cabinets",
  "email": "owner@acmecabinets.com",
  "product": "shop-os-foundation",
  "entitlements": ["foundation"],
  "created_at": "2026-05-24T12:00:00.000Z",
  "valid_until": null,
  "cancelled_at": null,
  "last_seen": "2026-05-31T14:22:00.000Z",
  "activations": 3
}
```

- `valid_until: null` means perpetual (Foundation is one-time paid).
- For subscription packs added later, set `valid_until` to ~30 days out and re-set monthly.
- `entitlements: ["foundation"]` is the minimum. Add `"marketing-pack"`, `"seo-pack"`, etc. as you sell add-ons.
- `last_seen` and `activations` track customer usage. Useful for retention/fraud detection later.

## Future: Stripe webhook integration

Once you have Stripe set up, point the `checkout.session.completed` webhook at `POST /issue` (with the admin token in the header). Map the customer's email and metadata to the JSON body. The Worker will generate a key and you can email it via a separate flow.

That is a small follow-up project. For the first 5–20 Shop OS customers, manual `./scripts/issue-license.sh` after each payment is fine.

## Local development

```sh
cp .dev.vars.example .dev.vars
# Edit .dev.vars and set ADMIN_TOKEN to a local-only value

wrangler dev
# Worker now runs at http://localhost:8787
```

`.dev.vars` is gitignored. Production secrets live in Cloudflare (set via `wrangler secret put`).

## Files in this project

```
shop-os-license-server/
├── README.md               (this file)
├── package.json
├── wrangler.toml           Cloudflare config + KV binding
├── tsconfig.json
├── .gitignore
├── .dev.vars.example       Template for local secrets
├── src/
│   └── index.ts            The Worker (one file, ~200 lines)
└── scripts/
    ├── issue-license.sh    Issue a new key
    └── revoke-license.sh   Revoke an existing key
```

## Pushing to GitHub

When ready, create a **private** repo at `github.com/blueprintit-ai/shop-os-license-server` and push:

```sh
cd "Projects/shop-os-license-server"
git init
git add .
git commit -m "Initial license server for Shop OS Foundation"
git remote add origin git@github.com:blueprintit-ai/shop-os-license-server.git
git push -u origin main
```

The `.gitignore` already excludes `.dev.vars`, `node_modules`, and `.wrangler/` so secrets never leak.

## Cost

Cloudflare Workers free tier:
- 100,000 requests per day
- 1,000 KV reads per day
- Unlimited KV writes (within reason)

For 200 Shop OS customers each validating once a week, that is roughly 30 reads per day. The free tier covers this 30x over. **Expected monthly cost: $0.**

<span style="background-color:#F4EFE3; color:#020309; padding:2px 8px; border-radius:3px; font-size:0.85em;">🤖 Blueprint IT Vault Operator, last edited: 2026-05-28T00:00:00Z</span>
