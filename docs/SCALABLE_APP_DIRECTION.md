# Scalable App Direction

Vaultr should move toward a prepared-data model: Discord and the future app interface should read stable shelves and market snapshots, while background workers do the slow market research.

## Current Baseline

- Discord commands are the primary user interface.
- SQLite is the local source of truth.
- Discovery market cache and reference cache already separate expensive data from the response surface.
- Discovery refresh requests now have a durable `discovery_market_refresh_jobs` table, so refresh work can survive restarts and be claimed by a worker process.
- `src/discovery-market-worker.ts` can claim durable Discovery market jobs and run refreshes outside the Discord bot process.
- `src/services/prepared-discovery.ts` exposes a network-free read model for existing persisted Discovery shelves, prepared market snapshots, and reference images.

## Target Shape

1. **Command/API layer**
   - Returns prepared shelves quickly.
   - Enqueues refresh jobs when data is missing, stale, or thin.
   - Avoids doing full marketplace research inline except for limited beta/admin paths.

2. **Worker layer**
   - Claims `discovery_market_refresh_jobs` rows.
   - Respects eBay backoff and request budgets centrally.
   - Writes `discovery_market_cache` and reference-cache updates.
   - Retries transient failures with `run_after` rather than blocking users.
   - Requeues stale `RUNNING` locks so crashed workers do not strand refresh jobs.

3. **App interface**
   - Reads user shelves, market snapshots, chase health, and taste profile state from prepared tables.
   - Shows refresh state separately from card recommendations.
   - Lets users tune recommendations without requiring Discord interactions.

4. **Production data layer**
   - SQLite is acceptable for private alpha and early beta.
   - Public deployment should move queue/state/cache tables to Postgres or another managed relational store.
   - A Redis/BullMQ-style queue can replace the DB-backed queue later if throughput requires it.

## Near-Term Steps

- Run and monitor the `discovery-market-worker` systemd unit in staging/beta.
- Change `/discover` to prefer cached snapshots and enqueue missing work, with foreground hydration behind a tighter timeout budget.
- Expand the app-facing read model from persisted Discovery shelves into refresh statuses and taste-profile summaries.
- Add per-user and global refresh cooldowns so public traffic cannot stampede eBay.
- Add operational views for queued/running/failed jobs before public beta.
