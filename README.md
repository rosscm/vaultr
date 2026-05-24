# Vaultr

Discord-native collector chase assistant.

## MVP Focus

- Discord slash commands for chase management
- Persistent chase criteria per user
- Source adapters (start with eBay)
- Alert pipeline with dedupe and relevance filtering

## Tech Stack

- Node.js + TypeScript
- discord.js
- SQLite via `better-sqlite3`

## Quick Start

1. Copy `.env.example` to `.env`
2. Fill Discord bot credentials
3. Install dependencies:
   - `npm install`
4. Register slash commands:
   - `npm run register:commands`
5. Run smoke checks:
   - `npm run smoke`
6. Run in dev mode:
   - `npm run dev`

## Initial Commands

- `/start`
- `/chase add`
- `/chase list`
- `/chase edit`
- `/chase remove`
- `/alerts settings`
- `/alerts recent`
- `/alerts preview`
- `/community-feed` (admin toggle)
- `/discover`
- `/help`
- `/health` (owner only)
- `/plan`
- `/plan-set` (admin/testing)
- `/setup-channel-set` (admin setup)
- `/upgrade`

## User Plans (Initial Plumbing)

- Default tier is `FREE`
- `FREE` limit: 3 active chases
- `PRO` limit: 50 active chases
- `/chase add` enforces active chase limits
- `/plan` shows the user's current tier and limits
- `/plan-set` lets server admins set a user's tier/status for testing

## Run As A Service (Raspberry Pi)

Use the included unit file: [deploy/vaultr.service](/Users/rossc10/projects/vaultr/deploy/vaultr.service)

1. Build once:
   - `npm run build`
2. Copy service:
   - `sudo cp deploy/vaultr.service /etc/systemd/system/vaultr.service`
3. Reload and enable:
   - `sudo systemctl daemon-reload`
   - `sudo systemctl enable vaultr`
   - `sudo systemctl start vaultr`
4. Check status/logs:
   - `sudo systemctl status vaultr`
   - `tail -f /home/pi/Documents/GitHub/vaultr/data/logs/vaultr.log`

### Log Rotation

Vaultr services write append-only logs under `data/logs`. Install the included logrotate config on the Pi to prevent stale logs from growing forever:

```sh
sudo cp deploy/vaultr.logrotate /etc/logrotate.d/vaultr
sudo logrotate -d /etc/logrotate.d/vaultr
```

The default keeps 8 weekly compressed rotations and uses `copytruncate` so the running services do not need to restart during rotation.

### Pi Deploy Checklist

- Repo is up to date:
  - `git pull`
- Dependencies are installed:
  - `npm install`
- Env is configured:
  - `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`
  - `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` (if `LISTING_SOURCE=EBAY` and `EBAY_SEARCH_API=BROWSE`)
  - `EBAY_APP_ID` (optional legacy fallback for `EBAY_SEARCH_API=FINDING`)
  - `LISTING_SOURCE`, `POLL_INTERVAL_SECONDS`
  - `OWNER_USER_ID` (optional, enables owner-only `/health`)
- Runtime checks pass:
  - `npm run smoke`
- Commands are registered:
  - `npm run register:commands`
- Service is restarted:
  - `sudo systemctl restart vaultr`

## eBay Polling

- Recommended production search path: `EBAY_SEARCH_API=BROWSE`
- Set `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` in `.env` (from your eBay production keyset)
- `EBAY_CLIENT_ID` is the App ID / Client ID shown in the eBay Developer portal
- Keep `EBAY_APP_ID` only if you want the legacy Finding API fallback with `EBAY_SEARCH_API=FINDING`
- Set `EBAY_ENV=SANDBOX` for sandbox testing, or `EBAY_ENV=PRODUCTION` for live eBay
- Set `EBAY_MARKETPLACE_ID=EBAY_US` unless you intentionally want another eBay marketplace
- Optional: tune `EBAY_SEARCH_LIMIT` (default `10`) and `EBAY_BROWSE_SORT` (default `newlyListed`)
- Recommended production soak: `POLL_INTERVAL_SECONDS=900`
- Recommended production soak: `EBAY_MAX_REQUESTS_PER_MINUTE=1`
- Recommended production soak: `EBAY_BACKOFF_BASE_SECONDS=900`
- Set `LISTING_SOURCE=EBAY` for live eBay polling
- Set `LISTING_SOURCE=MOCK` to run with local mock listings
- Optional: set `MOCK_LISTINGS_PATH` (defaults to `./data/mock-listings.example.json`)
- Alerts are delivered by DM to each user
- Similar active chases share source queries so eBay requests do not scale one-to-one with users
- `MAX_ALERTS_PER_CHASE_PER_POLL` caps how many distinct matches one chase can send from a single listing check (default `3`)

### eBay Rate Limit Notes

- eBay may return rate-limit errors from Browse or legacy Finding when calls are too frequent
- If that happens, avoid manual `curl` tests for 30-60 minutes because they count against the same limit
- Use `/health` to check `Rate Limited / Backing Off`, `Backoff Until`, and `Last Source Success`
- Keep production testing slow until `/health` stays clean for a day

## eBay Deletion Webhook (Compliance)

- Vaultr includes a webhook listener for eBay Marketplace Account Deletion notifications
- Run locally:
  - `npm run dev:webhook`
- Or from build:
  - `npm run build`
  - `npm run start:webhook`
- Required env vars:
  - `EBAY_NOTIFICATION_ENDPOINT_URL` (must exactly match your eBay endpoint URL)
  - `EBAY_NOTIFICATION_VERIFICATION_TOKEN` (32-80 chars, `A-Za-z0-9_-`)
- Optional env vars:
  - `EBAY_WEBHOOK_PORT` (default `8787`)
  - `EBAY_DELETION_AUDIT_PATH` (default `./data/ebay-deletions.log`)
- Current behavior:
  - Receives and validates challenge requests (`GET /ebay/notifications`)
  - Accepts notification payloads (`POST /ebay/notifications`)
  - Records deletion-event audit lines for compliance
  - No-op deletion action, since Vaultr currently stores no personal eBay account data

### Cloudflare Tunnel Setup (Pi)

Use this when your webhook runs on a Raspberry Pi and needs a public HTTPS endpoint.

1. Create a Cloudflare tunnel and DNS route (example hostname):
   - `cloudflared tunnel create vaultr-ebay-webhook`
   - `cloudflared tunnel route dns vaultr-ebay-webhook ebay-webhook.tweeticcini.com`
2. Create a dedicated tunnel config (example path):
   - `/home/pi/.cloudflared/vaultr-webhook.yml`
3. Example config:
   ```yaml
   tunnel: <TUNNEL_ID>
   credentials-file: /home/pi/.cloudflared/<TUNNEL_ID>.json

   ingress:
     - hostname: ebay-webhook.tweeticcini.com
       service: http://localhost:8787
     - service: http_status:404
   ```
4. Run tunnel as a separate service (recommended) so other apps are not disrupted:
   - Use your own `cloudflared-vaultr.service` with:
     - `ExecStart=/usr/bin/cloudflared tunnel --config /home/pi/.cloudflared/vaultr-webhook.yml run`
5. Verify endpoint:
   - `curl "https://ebay-webhook.tweeticcini.com/ebay/notifications?challenge_code=test123"`
   - Expected: JSON containing `challengeResponse`

### eBay Portal Verification Steps

1. Open your Production keyset in eBay Developers Program
2. Go to Notifications -> Marketplace Account Deletion
3. Set:
   - Endpoint URL: `https://ebay-webhook.tweeticcini.com/ebay/notifications`
   - Verification token: must match `EBAY_NOTIFICATION_VERIFICATION_TOKEN`
4. Click Save (this triggers eBay challenge validation)
5. Click Send Test Notification
6. Watch logs:
   - `sudo journalctl -u vaultr-ebay-webhook -f`

### Persistence on Pi

For persistent webhook runtime, use [deploy/vaultr-ebay-webhook.service](/Users/rossc10/projects/vaultr/deploy/vaultr-ebay-webhook.service):

1. Build webhook:
   - `npm run build`
2. Install unit:
   - `sudo cp deploy/vaultr-ebay-webhook.service /etc/systemd/system/vaultr-ebay-webhook.service`
3. Reload and start:
   - `sudo systemctl daemon-reload`
   - `sudo systemctl enable vaultr-ebay-webhook`
   - `sudo systemctl start vaultr-ebay-webhook`
4. Check status/logs:
   - `sudo systemctl status vaultr-ebay-webhook`
   - `sudo journalctl -u vaultr-ebay-webhook -f`

## Alert Controls

- Per-user controls via `/alerts settings`
- `min_score`: drop low-confidence matches
- `max_alerts_per_hour`: reduce alert bursts
- `chase_cooldown_minutes`: minimum minutes between alerts for the same chase
- `alert_currency`: currency used in alert pricing and max-price comparisons (`USD`, `CAD`, `EUR`, `GBP`, `JPY`)
- `max_price` compares against total cost when shipping is known, and item price when shipping is unavailable
- FX conversion uses live USD-based rates with background refresh and fallback to env overrides
- `quiet_start` / `quiet_end`: suppress alerts during quiet window (server local time)
- Recommended defaults: `min_score=60`, `max_alerts_per_hour=10`, quiet hours off
- Per-chase blocked terms via `negative_keywords` on `/chase add` and `/chase edit`
- Default blocked terms on new chases: `proxy, custom, reprint, lot, orica, replica`
- Per-chase `listing_type` filter: `ANY`, `AUCTION`, or `BUY_IT_NOW`
- Per-chase `priority`: `NORMAL`, `HIGH`, `GRAIL` (grails are shown first in `/chase list`)
- Per-chase `target_note`: short personal context shown in grail/match alerts
- Alert DMs include seller identity/feedback and shipping cost when available from source data
- Alert DMs include lightweight feedback buttons so users can mark whether a match fit their taste

## Reliability

- Poller prevents overlapping runs
- Source fetch uses timeout + retry
- Global source request budget and automatic backoff protect API usage
- DM send uses timeout
- Poller reliability details are available in service logs

## Command Channel Policy

- Admin sets the dedicated bot channel with `/setup-channel-set`
- All Vaultr commands (except setup and owner health) must be run in that channel
- Command responses are user-specific (ephemeral), alerts are DM-only
- Optional community activity feed can be enabled by admins via `/community-feed`
- When enabled, Vaultr posts:
  - One-time first-chase unlock message per user
  - Daily `Vault Pulse` collector bulletin in the setup channel
  - Weekly personal `Vault Reflection` journal DM to active users

### Digest Schedule Config

- `COMMUNITY_STATS_DAILY_ENABLED` (default `true`)
- `COMMUNITY_STATS_DAILY_HOUR_LOCAL` (default `20`)
- `COMMUNITY_STATS_DAILY_MINUTE_LOCAL` (default `0`)
- `WEEKLY_REFLECTION_ENABLED` (default `true`)
- `WEEKLY_REFLECTION_DAY_LOCAL` (default `0`, Sunday)
- `WEEKLY_REFLECTION_HOUR_LOCAL` (default `11`)
- `WEEKLY_REFLECTION_MINUTE_LOCAL` (default `0`)

## Production Notes

- Consider Postgres once Vaultr outgrows a single Pi/host deployment
- Add queue + worker for source polling and alert fanout
- Add observability (structured logs, metrics, alerts)
