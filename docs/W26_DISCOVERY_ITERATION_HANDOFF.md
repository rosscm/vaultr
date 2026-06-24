# W26 Discovery Iteration Handoff

Date: 2026-06-24

## Current State

- W26 Weekly Shelf for user `875643283995500625` is being actively iterated with `npm run weekly:refresh`.
- Latest refresh used queued market hydration:
  - `npm run weekly:refresh -- --date 2026-06-23 --user 875643283995500625 --no-hydrate-market`
- Latest W26 metadata after refresh:
  - `status=PARTIAL`
  - `items=18`
  - `marketReady=16`
  - `imageReady=18`
  - `updated=2026-06-24T04:24:31.537Z`
- Bot was rebuilt and restarted during iteration. Latest observed service PID was `3588962` before this handoff.

## What Improved

- `Raichu No.026 Intro Pack Bulbasaur Deck 1999 Japanese` now appears in W26.
- Raichu is now `READY`, with one specific CAD ask comp:
  - `Pokemon TCG 1999 Bulbasaur Deck Raichu No.026 003 Japanese LP-`
  - `askingTotal=424.76`
  - `askingSampleSize=1`
- Exact niche Japanese/deck-exclusive cards now get explicit Discovery support:
  - dedicated `niche-japanese` weekly taste lane
  - exact niche thin-comp readiness/evidence exception
  - niche grail-shape ranking boost
- Weak broad-bird spillover was tightened:
  - `Zapdos Generations 29` is gone from the latest W26 shelf
  - generic Black Star single-bird cards are no longer treated as premium enough when only supported by the trio bird chase
- Ordinary non-premium VMAX gets penalized.
- Jumbo/oversized listings are now rejected as market evidence.
- Stale jumbo/oversized cache rows were cleared, and no stale jumbo rows were present in the latest cache check.

## Still Unresolved

- Raichu is still too low in the current W26 order, around position 16, behind conventional promo/GX/format cards.
- The shelf still feels too conventional in the middle, with rows such as:
  - `Mewtwo & Mew-GX Unified Minds 222`
  - `Mewtwo & Mew-GX SM Black Star Promos SM191`
  - `Mew VMAX Fusion Strike 269`
  - `Pikachu ex Surging Sparks 238`
  - `Umbreon-GX SM Black Star Promos SM36`
  - `Umbreon & Darkrai-GX SM Black Star Promos SM241`
  - `Pikachu & Zekrom-GX SM Black Star Promos SM168`
  - `Pikachu-GX SM Black Star Promos SM232`
- The niche boost affects source ranking, but final shelf selection still seems to preserve too many ready conventional cards before the niche lane can move higher.
- Likely next code surface:
  - `selectVisibleCandidatesForCount`
  - `blendWeeklyTasteLaneCandidates`
  - final prepared shelf ordering before `scheduledDropItemsFromCandidates`
- Goal for next session:
  - make exact niche/grail-shape picks compete earlier in the final visible order
  - reduce ordinary GX/format/promo density when niche Japanese/e-reader/promo grail shapes are available
  - keep low-comp niche cards visible without overstating market confidence in the embed copy

## Useful Commands

```sh
npm run backup
npm run weekly:refresh -- --date 2026-06-23 --user 875643283995500625 --dry-run
npm run weekly:refresh -- --date 2026-06-23 --user 875643283995500625 --no-hydrate-market
```

Inspect current W26 shelf:

```sh
sqlite3 -header -column data/vaultr.db "SELECT i.position, i.suggestion_name, json_extract(i.suggestion_json,'$.lane') AS lane, i.market_status, i.asking_total, i.asking_sample_size, i.listing_title FROM discovery_scheduled_drop_items i WHERE i.user_id='875643283995500625' AND i.drop_type='WEEKLY_DISCOVERY' AND i.period_key='2026-W26' ORDER BY i.position;"
```

Check key cache rows:

```sh
sqlite3 -header -column data/vaultr.db "SELECT suggestion_name, display_currency, typical_raw_asking_total, market_sample_size, source_status, listing_title, updated_at FROM discovery_market_cache WHERE lower(suggestion_name) LIKE '%raichu%' OR lower(listing_title) LIKE '%jumbo%' OR lower(listing_title) LIKE '%oversized%' ORDER BY updated_at DESC LIMIT 30;"
```

## Recent Validation

- `npm test -- src/commands/__tests__/discover.test.ts` passed with 148 tests after the latest code changes.
- `npm run build` passed after the latest code changes.

## DB Backups Created During Iteration

- `data/backups/vaultr-2026-06-24T03-39-34-995Z.db`
- `data/backups/vaultr-2026-06-24T03-54-01-189Z.db`
- `data/backups/vaultr-2026-06-24T03-58-43-225Z.db`
- `data/backups/vaultr-2026-06-24T04-04-01-048Z.db`
- `data/backups/vaultr-2026-06-24T04-11-05-327Z.db`
- `data/backups/vaultr-2026-06-24T04-17-17-406Z.db`
- `data/backups/vaultr-2026-06-24T04-23-15-080Z.db`