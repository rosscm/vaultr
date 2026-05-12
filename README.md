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

- `/chase-add`
- `/chase-list`
- `/chase-remove`
- `/chase-test`

## Production Notes

- Replace in-memory storage with Postgres
- Add queue + worker for source polling and alert fanout
- Add observability (structured logs, metrics, alerts)
