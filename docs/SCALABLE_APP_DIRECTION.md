# Scalable App Direction

KeepSeek uses a prepared-data model: the web app reads stable Display Cases and market snapshots while background workers do slow market research. Discord is an optional listing-alert delivery channel.

## Current Baseline

- The web app is the primary user interface.
- SQLite is the local source of truth.
- Discovery market cache and reference cache already separate expensive data from the response surface.
- Discovery refresh requests now have a durable `discovery_market_refresh_jobs` table, so refresh work can survive restarts and be claimed by a worker process.
- `src/discovery-market-worker.ts` can claim durable Discovery market jobs and run refreshes outside the Discord bot process.
- `src/services/prepared-discovery.ts` exposes a network-free read model for existing persisted Discovery shelves, prepared market snapshots, and reference images.
- `src/services/scheduled-discovery-drops.ts` stores scheduled Display Cases as durable releases with normalized item rows for web reads.
- The web API reads the current prepared Display Case for Plus users; Free users receive editorial collector picks/general finds.
- `src/services/discovery-drop-scheduler.ts` prepares personalized Display Cases in bounded batches without a Discord client or announcement dependency.
- Display Case views and feedback operate through authenticated web endpoints; market refresh work stays in background workers.
- Discovery market refresh enqueueing has per-user cooldowns and a global active-job cap so shelf opens cannot stampede eBay.
- Discovery feedback is release-training input: More Like / Not For Me affects future shelves, and feedback confirmations support Undo.
- eBay result windows and item-detail enrichment are capped in code, with smoke checks guarding unsafe env values.
- `/health` and ops checks now track active-chase freshness so tail latency is visible before broad launch.

## Target Shape

1. **Command/API layer**
   - Returns prepared shelves quickly.
   - Enqueues refresh jobs when data is missing, stale, or thin.
   - Avoids doing full marketplace research inline except for limited beta/admin paths.
   - Treats the persisted web-readable Display Case as the scheduler's product output.

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
   - Integrates Stripe for plan entitlement state, billing portal links, and webhook-driven subscription updates.

4. **Production data layer**
   - SQLite is acceptable for private alpha and early beta.
   - Public deployment should move queue/state/cache tables to Postgres or another managed relational store.
   - A Redis/BullMQ-style queue can replace the DB-backed queue later if throughput requires it.

## Near-Term Steps

- Run and monitor the `discovery-market-worker` systemd unit in staging/beta.
- Extend the scheduler to prepare Market Radar before Friday availability and Release Watch around new-set windows.
- Expand scheduled drops into taste-profile summaries and refresh statuses.
- Tune Discovery refresh cooldowns and active-job caps from beta traffic.
- Add operational views for queued/running/failed jobs before public beta.
- Track beta readiness weekly: active users, active chases, average/peak source calls, deferred groups, and worst overdue chase.
- Keep public launch gated on sustained chase freshness: no active chase over 4x plan interval during normal source availability.
- Wire Stripe subscription lifecycle into `user_plans` before selling Pro outside manual/admin testing.
