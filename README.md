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
5. Run in dev mode:
   - `npm run dev`

## Initial Commands

- `/alerts-channel-set`
- `/alerts-settings`
- `/chase-add`
- `/chase-edit`
- `/chase-list`
- `/chase-remove`
- `/chase-test`
- `/plan`
- `/plan-set` (admin/testing)
- `/status`

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
   - `tail -f /home/pi/Documents/GitHub/vaultr/vaultr.log`

## eBay Polling

- Set `EBAY_APP_ID` in `.env` (from eBay Developer Program)
- Optional: tune `POLL_INTERVAL_SECONDS` (default `180`)
- Set `LISTING_SOURCE=EBAY` for live eBay polling
- Set `LISTING_SOURCE=MOCK` to run with local mock listings
- Optional: set `MOCK_LISTINGS_PATH` (defaults to `./data/mock-listings.example.json`)
- Alerts are posted to configured server channel (`/alerts-channel-set`) or DM fallback

## Alert Controls

- Per-user controls via `/alerts-settings`
- `min_score`: drop low-confidence matches
- `max_alerts_per_hour`: reduce alert bursts
- `quiet_start` / `quiet_end`: suppress alerts during quiet window (server local time)
- Per-chase blocked terms via `negative_keywords` on `/chase-add` and `/chase-edit`

## Production Notes

- Replace in-memory storage with Postgres
- Add queue + worker for source polling and alert fanout
- Add observability (structured logs, metrics, alerts)
