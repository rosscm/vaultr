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
- `/chase-add`
- `/chase-edit`
- `/chase-list`
- `/chase-remove`
- `/chase-test`

## eBay Polling

- Set `EBAY_APP_ID` in `.env` (from eBay Developer Program)
- Optional: tune `POLL_INTERVAL_SECONDS` (default `180`)
- Set `LISTING_SOURCE=EBAY` for live eBay polling
- Set `LISTING_SOURCE=MOCK` to run with local mock listings
- Optional: set `MOCK_LISTINGS_PATH` (defaults to `./data/mock-listings.example.json`)
- Alerts are posted to configured server channel (`/alerts-channel-set`) or DM fallback

## Production Notes

- Replace in-memory storage with Postgres
- Add queue + worker for source polling and alert fanout
- Add observability (structured logs, metrics, alerts)
