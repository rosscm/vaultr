# Vaultr

Build your Vault. Chase your grails. Discover what you love next.

Vaultr is a Discord-native collector companion for card chases, grail sightings, and ambient discovery. It keeps the command surface small, sends chase alerts privately, and lets a collector's active chases shape what Vaultr surfaces over time.

## Product Focus

- Discord slash commands for building a personal Vault
- Persistent chase criteria and collector context per user
- Source adapters for eBay and trusted shop sources
- DM-first grail sightings with dedupe and fit scoring
- Prepared Discovery shelves shaped by the user's active chases and taste memory
- Scheduled Discovery drop announcements that open personalized private shelves from the channel instead of spamming DMs
- Optional community heartbeat for shared collector activity

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
- `/feed` (admin toggle)
- `/help`
- `/health` (owner only)
- `/plan view`
- `/plan set` (admin/testing)
- `/setup channel` (admin setup)
- `/upgrade`

## User Plans

- Default tier is `FREE`
- `FREE` limit: 3 active chases
- `PRO` limit: 50 active chases
- `/chase add` enforces active chase limits
- Free users can submit Pro-only chase modifiers, but Vaultr ignores those modifiers until Pro instead of rejecting the whole chase
- `/plan view` shows the user's current tier and limits
- `/plan set` lets server admins set a user's tier/status for testing

## Run As Services (Raspberry Pi)

Use the included bot, worker, backup, and ops unit files:

- [deploy/vaultr.service](deploy/vaultr.service)
- [deploy/vaultr-discovery-market-worker.service](deploy/vaultr-discovery-market-worker.service)
- [deploy/vaultr-backup.service](deploy/vaultr-backup.service)
- [deploy/vaultr-backup.timer](deploy/vaultr-backup.timer)
- [deploy/vaultr-ops-check.service](deploy/vaultr-ops-check.service)
- [deploy/vaultr-ops-check.timer](deploy/vaultr-ops-check.timer)

1. Build once:
   - `npm run build`
2. Copy services:
   - `sudo cp deploy/vaultr.service /etc/systemd/system/vaultr.service`
   - `sudo cp deploy/vaultr-discovery-market-worker.service /etc/systemd/system/vaultr-discovery-market-worker.service`
   - `sudo cp deploy/vaultr-backup.service /etc/systemd/system/vaultr-backup.service`
   - `sudo cp deploy/vaultr-backup.timer /etc/systemd/system/vaultr-backup.timer`
   - `sudo cp deploy/vaultr-ops-check.service /etc/systemd/system/vaultr-ops-check.service`
   - `sudo cp deploy/vaultr-ops-check.timer /etc/systemd/system/vaultr-ops-check.timer`
3. Reload and enable:
   - `sudo systemctl daemon-reload`
   - `sudo systemctl enable vaultr`
   - `sudo systemctl enable vaultr-discovery-market-worker`
   - `sudo systemctl enable vaultr-backup.timer`
   - `sudo systemctl enable vaultr-ops-check.timer`
   - `sudo systemctl start vaultr`
   - `sudo systemctl start vaultr-discovery-market-worker`
   - `sudo systemctl start vaultr-backup.timer`
   - `sudo systemctl start vaultr-ops-check.timer`
4. Check status/logs:
   - `sudo systemctl status vaultr`
   - `sudo systemctl status vaultr-discovery-market-worker`
   - `sudo systemctl status vaultr-backup.timer`
   - `sudo systemctl status vaultr-ops-check.timer`
   - `tail -f /home/pi/Documents/GitHub/vaultr/data/logs/vaultr.log`
   - `tail -f /home/pi/Documents/GitHub/vaultr/data/logs/discovery-market-worker.log`
   - `tail -f /home/pi/Documents/GitHub/vaultr/data/logs/backup.log`
   - `tail -f /home/pi/Documents/GitHub/vaultr/data/logs/ops-check.log`

### Log Rotation

Vaultr services write append-only logs under `data/logs`. Install the included logrotate config on the Pi to prevent stale logs from growing forever:

```sh
sudo cp deploy/vaultr.logrotate /etc/logrotate.d/vaultr
sudo logrotate -d /etc/logrotate.d/vaultr
```

The default keeps 8 weekly compressed rotations and uses `copytruncate` so the running services do not need to restart during rotation.

### SQLite Backups

Vaultr's live state is stored in SQLite at `DATABASE_PATH`. Use the included online backup command before public deploys and before risky maintenance:

```sh
npm run backup
```

Backups are written to `VAULTR_BACKUP_DIR` (default `./data/backups`) and are ignored by git with the rest of `data/*`. The command uses SQLite's backup API, so the bot and worker do not need to be stopped for routine backups.

On the Pi, install [deploy/vaultr-backup.service](deploy/vaultr-backup.service) and [deploy/vaultr-backup.timer](deploy/vaultr-backup.timer) so SQLite backups run automatically. The timer runs once after boot and then every 12 hours with a small randomized delay, keeping backup age comfortably under the default 24-hour ops threshold.

For a restore drill on the Pi:

1. Stop writers:
   - `sudo systemctl stop vaultr vaultr-discovery-market-worker vaultr-ebay-webhook`
2. Preserve the current database before replacing it:
   - `cp data/vaultr.db "data/vaultr.pre-restore.$(date -u +%Y%m%dT%H%M%SZ).db"`
3. Restore the selected backup:
   - `cp data/backups/<backup-file>.db data/vaultr.db`
4. Restart and verify:
   - `sudo systemctl start vaultr vaultr-discovery-market-worker vaultr-ebay-webhook`
   - `npm run smoke`
   - `npm run ops:check`

### Operational Health Checks

Run this manually after each deploy:

```sh
npm run ops:check
```

The check verifies configured systemd services are active, the SQLite database exists, and a recent backup is present. Tune `VAULTR_OPS_SERVICES` if the webhook is not installed in an environment, and tune `VAULTR_BACKUP_MAX_AGE_HOURS` for the maximum allowed backup age.

If any check fails, `ops:check` can DM the owner through Discord. By default it uses `OWNER_USER_ID`; set `VAULTR_OPS_ALERT_USER_ID` to override the recipient. Duplicate alerts for the same failure are suppressed for `VAULTR_OPS_ALERT_COOLDOWN_MINUTES` and tracked in `VAULTR_OPS_ALERT_STATE_PATH`. Set `VAULTR_OPS_ALERT_DRY_RUN=true` to test alert formatting without sending a DM.

For continuous Pi monitoring, install [deploy/vaultr-ops-check.service](deploy/vaultr-ops-check.service) and [deploy/vaultr-ops-check.timer](deploy/vaultr-ops-check.timer). The timer runs every 10 minutes, writes to `data/logs/ops-check.log`, and can be watched with:

```sh
systemctl list-timers vaultr-ops-check.timer
sudo journalctl -u vaultr-ops-check.service -n 50
```

### Pi Deploy Checklist

- Repo is up to date:
  - `git pull`
- Dependencies are installed:
  - `npm install`
- Env is configured:
  - `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`
   - `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` (if `LISTING_SOURCE=EBAY`)
   - `EBAY_APP_ID` (optional; used for sold-comps market context)
  - `LISTING_SOURCE`, `POLL_INTERVAL_SECONDS`
  - `OWNER_USER_ID` (optional, enables owner-only `/health`)
- Runtime checks pass:
  - `npm run smoke`
- A fresh SQLite backup exists:
   - `npm run backup`
- Operational checks pass:
   - `npm run ops:check`
- Backup and ops timers are enabled:
   - `systemctl is-enabled vaultr-backup.timer`
   - `systemctl list-timers vaultr-backup.timer`
   - `systemctl is-enabled vaultr-ops-check.timer`
   - `systemctl list-timers vaultr-ops-check.timer`
- Optional Discovery drops are tuned:
   - `DISCOVERY_DROP_SCHEDULER_ENABLED`, `DISCOVERY_DROP_ANNOUNCEMENTS_ENABLED`, `DISCOVERY_DROP_PREPARE_BATCH_SIZE`
   - `DISCOVERY_MARKET_REFRESH_USER_COOLDOWN_SECONDS`, `DISCOVERY_MARKET_REFRESH_MAX_ACTIVE_JOBS`
   - `DISCOVERY_MARKET_WORKER_BATCH_SIZE`, `DISCOVERY_MARKET_WORKER_POLL_MS`, `DISCOVERY_MARKET_WORKER_LOCK_TIMEOUT_MS`
- Commands are registered:
  - `npm run register:commands`
- Services are restarted:
  - `sudo systemctl restart vaultr`
   - `sudo systemctl restart vaultr-discovery-market-worker`

## eBay Polling

- Production listing search uses the eBay Browse API
- Set `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` in `.env` (from your eBay production keyset)
- `EBAY_CLIENT_ID` is the App ID / Client ID shown in the eBay Developer portal
- Set `EBAY_APP_ID` if you want sold-comps market context from eBay Finding completed items
- Set `EBAY_ENV=SANDBOX` for sandbox testing, or `EBAY_ENV=PRODUCTION` for live eBay
- Set `EBAY_MARKETPLACE_ID=EBAY_US` unless you intentionally want another eBay marketplace
- Optional: tune `EBAY_SEARCH_LIMIT` (default `50`) and `EBAY_BROWSE_SORT` (default `newlyListed`)
- Optional: tune `EBAY_SEARCH_CACHE_TTL_SECONDS` (default `120`) to reuse recent successful eBay searches across alerts, debug, and Discovery market refreshes
- Optional: set `EBAY_AFFILIATE_CAMPAIGN_ID` after eBay Partner Network approval to decorate Discovery card click URLs; `EBAY_AFFILIATE_CUSTOM_ID`, `EBAY_AFFILIATE_MARKETPLACE_ID`, and `EBAY_AFFILIATE_TOOL_ID` can override the defaults.
- Recommended production runtime tick: `POLL_INTERVAL_SECONDS=300`
- Plan intervals still control chase eligibility: Free every 30 minutes, Pro every 15 minutes
- Recommended production source budget: `EBAY_MAX_REQUESTS_PER_MINUTE=10`
- Recommended production request spacing: `EBAY_MIN_REQUEST_GAP_MS=10000`
- Recommended production soak: `EBAY_BACKOFF_BASE_SECONDS=900`
- Set `LISTING_SOURCE=EBAY` for live eBay polling
- Set `LISTING_SOURCE=MOCK` to run with local mock listings
- Optional: set `MOCK_LISTINGS_PATH` (defaults to `./data/mock-listings.example.json`)
- Sighting moments are delivered by DM to each user
- Similar active chases share source queries so eBay requests do not scale one-to-one with users
- Successful eBay search results are cached briefly and rate-limit responses are never cached
- `MAX_ALERTS_PER_CHASE_PER_POLL` caps how many distinct sightings one chase can send from a single source check (default `3`)

## Scheduled Discovery Drops

- The bot prepares Pro Weekly Discovery shelves in the background and stores them in SQLite.
- Pro Weekly Shelves prepare up to 20 cards by default and open privately from the channel in 10-card pages.
- Free users can open the same announcement button for a three-card Weekly Shelf preview based on active Vault signals.
- If a Pro shelf has fewer than 20 cards, Vaultr tells the user their Vault is still light and needs more taste signals.
- Each configured server command channel gets at most one public Weekly Discovery announcement per period.
- The announcement button opens the clicker's own shelf or preview as a private channel interaction, so Discovery drops avoid DM spam and public shelf clutter.
- Shelf feedback trains the next Discovery release; it does not reshuffle the current release on demand.
- Feedback confirmations include Undo so accidental More Like / Not For Me taps can be reverted.
- Discovery is opened from scheduled drop announcements; the slash command is intentionally not registered for users.
- Runtime controls:
   - `DISCOVERY_DROP_SCHEDULER_ENABLED=true` enables background preparation.
   - `DISCOVERY_DROP_ANNOUNCEMENTS_ENABLED=true` enables configured-channel announcements.
   - `DISCOVERY_WEEKLY_DROP_SIZE=20` controls Pro shelf depth, capped at 20 for Discord.
   - `DISCOVERY_DROP_PREPARE_BATCH_SIZE=3` limits how many user shelves one scheduler tick prepares.
   - `DISCOVERY_DROP_SCHEDULER_INTERVAL_SECONDS=900` controls how often the scheduler wakes up.
   - `DISCOVERY_MARKET_REFRESH_USER_COOLDOWN_SECONDS=300` limits repeated refresh enqueue bursts per user.
   - `DISCOVERY_MARKET_REFRESH_MAX_ACTIVE_JOBS=250` caps queued/running Discovery market refresh work.
   - `DISCOVERY_MARKET_WORKER_BATCH_SIZE=1` and `DISCOVERY_MARKET_WORKER_POLL_MS=5000` keep worker source usage steady.
   - `DISCOVERY_MARKET_WORKER_LOCK_TIMEOUT_MS=600000` lets the worker recover stale running jobs after crashes.

### eBay Rate Limit Notes

- eBay may return rate-limit errors from Browse or sold-comps requests when calls are too frequent
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

For persistent webhook runtime, use [deploy/vaultr-ebay-webhook.service](deploy/vaultr-ebay-webhook.service):

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

## Vault Signal Controls

- Per-user controls via `/alerts settings`
- `min_score`: minimum fit score before Vaultr sends a DM sighting
- `alert_volume`: friendly DM volume preference (`Quiet` 3/hour, `Balanced` 10/hour, `More` 25/hour)
- `alert_currency`: price currency used for listing prices and max-price comparisons (`USD`, `CAD`, `EUR`, `GBP`, `JPY`)
- `shipping_country`: optional per-user ship-to country used to warn when a listing may not ship to you; selected from common destinations aligned with supported currencies
- `source`: where Vaultr watches for sightings (`eBay`, `eBay + Trusted Shops`, or `Trusted Shops Only`; default `eBay`; trusted shop sources are Pro)
- `max_price` compares against total cost when shipping is known, and item price when shipping is unavailable
- FX conversion uses live USD-based rates with background refresh and fallback to env overrides
- Recommended defaults: `source=eBay`, `min_score=60`, `alert_volume=Balanced`, `alert_currency=USD`
- Pro per-chase blocked terms via `negative_keywords` on `/chase add` and `/chase edit`
- Default blocked terms on new chases: `proxy, custom, reprint, lot, orica, replica`
- Per-chase grading uses `grading_type` plus `grade_value`, or `Raw / Ungraded` for raw cards only
- Per-chase `condition` uses thresholds like `LP or better` and `MP or better`
- Per-chase `listing_type` filter: `ANY`, `AUCTION`, or `BUY_IT_NOW`
- Per-chase `priority`: `NORMAL`, `HIGH`, `GRAIL` (grails are shown first in `/chase list`)
- Per-chase `target_note`: short personal context shown in grail sightings
- Sighting DMs include seller identity/feedback and shipping cost when available from source data
- Sighting DMs include lightweight feedback buttons so users can mark whether a card fit their taste

## Reliability

- Poller prevents overlapping runs
- Source fetch uses timeout + retry
- Global source request budget and automatic backoff protect API usage
- DM send uses timeout
- Poller reliability details are available in service logs

## Command Channel Policy

- Admin sets the dedicated bot channel with `/setup channel`
- All Vaultr commands (except setup and owner health) must be run in that channel
- Command responses are user-specific (ephemeral), sightings are DM-only
- Optional community activity feed can be enabled by admins via `/feed`
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

## Public Beta Discord Checklist

- Use Discord OAuth scopes `bot` and `applications.commands`.
- Avoid `Administrator`; grant only the channel permissions Vaultr needs: View Channel, Send Messages, Embed Links, Read Message History, and Use External Emojis/Stickers if your server styling needs them.
- Confirm the bot can DM users for chase sightings and weekly reflections; Discovery shelves open privately from the server channel and do not require DMs.
- Require admins to run `/setup channel` after install so command usage stays in one visible server channel.
- Add support and privacy links in the Discord Developer Portal before broad invites; keep the same links in public docs or the invite page.
- Test the invite in a throwaway server with a non-owner user before sharing publicly.

## Production Notes

- Consider Postgres once Vaultr outgrows a single Pi/host deployment
- Discovery market refreshes already use a durable SQLite queue plus worker; source polling and sighting fanout still run in the bot process
- Keep the bot, Discovery worker, and optional eBay webhook as separate systemd units so each can restart independently
- Use `npm run ops:check` from cron, a systemd timer, or an external command monitor until structured metrics and alerts exist
