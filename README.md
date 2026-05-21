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
- PostgreSQL (recommended in production)

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

- `/alerts-settings`
- `/alerts-settings-reset`
- `/alerts-recent`
- `/community-feed` (admin toggle)
- `/chase-add`
- `/chase-edit`
- `/chase-list`
- `/chase-remove`
- `/chase-test`
- `/help`
- `/plan`
- `/plan-set` (admin/testing)
- `/setup-channel-set` (admin setup)
- `/upgrade`

## User Plans (Initial Plumbing)

- Default tier is `FREE`
- `FREE` limit: 3 active chases
- `PRO` limit: 50 active chases
- `/chase-add` enforces active chase limits
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

### Pi Deploy Checklist

- Repo is up to date:
  - `git pull`
- Dependencies are installed:
  - `npm install`
- Env is configured:
  - `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`
  - `EBAY_APP_ID` (if `LISTING_SOURCE=EBAY`)
  - `LISTING_SOURCE`, `POLL_INTERVAL_SECONDS`
- Runtime checks pass:
  - `npm run smoke`
- Commands are registered:
  - `npm run register:commands`
- Service is restarted:
  - `sudo systemctl restart vaultr`

## eBay Polling

- Set `EBAY_APP_ID` in `.env` (from eBay Developer Program)
- Set `EBAY_ENV=SANDBOX` for sandbox testing, or `EBAY_ENV=PRODUCTION` for live eBay
- Optional: tune `POLL_INTERVAL_SECONDS` (default `180`)
- Optional: tune `EBAY_MAX_REQUESTS_PER_MINUTE` (default `20`)
- Optional: tune `EBAY_BACKOFF_BASE_SECONDS` (default `30`)
- Set `LISTING_SOURCE=EBAY` for live eBay polling
- Set `LISTING_SOURCE=MOCK` to run with local mock listings
- Optional: set `MOCK_LISTINGS_PATH` (defaults to `./data/mock-listings.example.json`)
- Alerts are delivered by DM to each user

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

- Per-user controls via `/alerts-settings`
- `min_score`: drop low-confidence matches
- `max_alerts_per_hour`: reduce alert bursts
- `chase_cooldown_minutes`: minimum minutes between alerts for the same chase
- `alert_currency`: currency used in alert pricing and max-price comparisons (`USD`, `CAD`, `EUR`, `GBP`, `JPY`)
- FX conversion uses live USD-based rates with background refresh and fallback to env overrides
- `quiet_start` / `quiet_end`: suppress alerts during quiet window (server local time)
- Recommended defaults: `min_score=60`, `max_alerts_per_hour=10`, quiet hours off
- Use `/alerts-settings-reset` to restore recommended defaults
- Per-chase blocked terms via `negative_keywords` on `/chase-add` and `/chase-edit`
- Default blocked terms on new chases: `proxy, custom, reprint, lot, orica, replica`
- Per-chase `listing_type` filter: `ANY`, `AUCTION`, or `BUY_IT_NOW`
- Per-chase `priority`: `NORMAL`, `HIGH`, `GRAIL` (grails are shown first in `/chase-list`)
- Per-chase `target_note`: short personal context shown in grail/match alerts
- Alert DMs include seller identity/feedback and shipping cost when available from source data

## Reliability

- Poller prevents overlapping runs
- Source fetch uses timeout + retry
- Global source request budget and automatic backoff protect API usage
- DM send uses timeout
- Poller reliability details are available in service logs

## Command Channel Policy

- Admin sets the dedicated bot channel with `/setup-channel-set`
- All Vaultr commands (except setup itself) must be run in that channel
- Command responses are user-specific (ephemeral), alerts are DM-only
- Optional community activity feed can be enabled by admins via `/community-feed`
- When enabled, Vaultr posts:
  - One-time first-chase unlock message per user
  - Daily `Vaultr Stats` digest in the setup channel

## Production Notes

- Replace in-memory storage with Postgres
- Add queue + worker for source polling and alert fanout
- Add observability (structured logs, metrics, alerts)
