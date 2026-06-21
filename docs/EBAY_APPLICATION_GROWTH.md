# eBay Application Growth Request

Use this as the working copy for an eBay Developer support ticket or App Check / Application Growth request.

## Short Summary

Vaultr is a Discord-native collector companion that helps users monitor personally saved trading-card chases and receive relevant listing sightings by DM. eBay Browse is used for user-requested chase monitoring and optional cached market context. Vaultr does not scrape eBay pages, does not automate purchasing, and does not expose eBay data as a public search engine.

## Suggested Request

Hello eBay Developer Support,

I am requesting application growth / quota review for Vaultr, a collector companion for trading-card users. Vaultr uses the eBay Browse API to help users monitor their own saved card chases and receive relevant listing sightings in Discord DMs.

The application is designed to be conservative with eBay traffic:

- User chases are grouped by normalized query so similar saved chases share source calls.
- Requests are centrally rate-limited across OAuth, Browse search, Browse item detail, and sold-comps requests.
- Production request ceilings are explicit environment settings and deployment smoke checks reject unsafe page-size values.
- Browse search windows are capped at 50 returned items, with a lower default of 25 when `EBAY_SEARCH_LIMIT` is unset.
- Browse item-detail enrichment is capped per search so one user query cannot expand into an unbounded number of item API calls.
- Browse rate-limit responses trigger backoff and are not retried through legacy fallback APIs.
- Discovery is cache-first and does not depend on live eBay calls to render user-facing recommendations.
- Market context for Discovery is cached and refreshed in the background only for visible suggestions.
- Listing alerts are deduplicated by listing/source and capped per chase per poll.
- Users control alert volume, minimum match score, currency, shipping country, and listing source preferences.
- Vaultr includes a Marketplace Account Deletion notification endpoint and records deletion notifications for compliance.

The requested growth is intended to support legitimate user chase monitoring and Pro market context while preserving conservative request behavior. We are not seeking to bypass rate limits; we want appropriate production capacity for a compliant application that already implements throttling, caching, dedupe, and backoff.

Thank you for reviewing.

## App Behavior Details

- Primary listing API: eBay Browse API.
- Sold-comps market context uses eBay Finding completed items when configured.
- Marketplace: usually `EBAY_US`.
- Search cadence: runtime poll tick is typically 5 minutes; per-user plan intervals control chase eligibility.
- Free chases: checked no more often than every 30 minutes.
- Pro chases: checked no more often than every 15 minutes.
- Similar active chases are grouped so source requests do not scale one-to-one with user count.
- Poller health tracks deferred source groups, oldest overdue chase, source budget at deferral, and live overdue pressure.
- Alerts are sent by Discord DM and include fit scoring, seller trust signals, price comparison, and dedupe controls.

## Compliance Notes

- Vaultr does not store personal eBay account credentials or OAuth user tokens.
- eBay production credentials are stored server-side in environment variables.
- The deletion webhook listens at `/ebay/notifications` and supports eBay challenge verification.
- Deletion notifications are processed and audit-logged.
- Runtime logs are rotated with logrotate.
- Services run under systemd with memory controls.

## Current Technical Safeguards

- Shared eBay HTTP request budget in `src/services/ebay.ts`.
- Backoff state visible through `/health`.
- Chase freshness is checked by `npm run ops:check`; active chases over 4x their plan interval fail ops checks.
- Source deferrals are logged with chase name, reason, and request-budget state for later diagnosis.
- Discovery market cache in SQLite.
- Reference card images are sourced outside eBay where possible.
- eBay market reads are optional supporting context, not the core Discovery source.

## Current Production Guardrails

```text
EBAY_SEARCH_LIMIT<=50, default 25
EBAY_SOLD_SEARCH_LIMIT<=50
EBAY_SOLD_SEARCH_PAGES<=5
EBAY_MAX_ENRICH_ITEMS_PER_SEARCH<=10, default 3
EBAY_MAX_REQUESTS_PER_MINUTE>=1
EBAY_MIN_REQUEST_GAP_MS>=0
EBAY_BACKOFF_BASE_SECONDS>=1
VAULTR_OPS_MAX_OVERDUE_INTERVAL_MULTIPLE=4 by default
```

## Beta Evidence To Collect Before Submitting

- Average and peak eBay requests per minute.
- Number of deferred source groups per day and the most common deferral reason.
- Worst active-chase overdue time and count of chases over 2x/4x their plan interval.
- Discovery market queue depth, failed jobs, and retry volume.
- Current beta user count, active chase count, and average active chases per user.

## Evidence To Mention If Asked

Recent local evidence did not indicate exhaustion of a 5,000/day Browse quota. The observed failures were a small number of `RATE_LIMITED` cache rows, suggesting short-window, endpoint, or app-check throttling rather than high daily volume.
