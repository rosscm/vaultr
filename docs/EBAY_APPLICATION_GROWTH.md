# eBay Application Growth Request

Use this as the working copy for an eBay Developer support ticket or App Check / Application Growth request.

## Short Summary

Vaultr is a Discord-native collector companion that helps users monitor personally saved trading-card chases and receive relevant listing sightings by DM. eBay Browse is used for user-requested chase monitoring and optional cached market context. Vaultr does not scrape eBay pages, does not automate purchasing, and does not expose eBay data as a public search engine.

## Suggested Request

Hello eBay Developer Support,

I am requesting application growth / quota review for Vaultr, a collector companion for trading-card users. Vaultr uses the eBay Browse API to help users monitor their own saved card chases and receive relevant listing sightings in Discord DMs.

The application is designed to be conservative with eBay traffic:

- User chases are grouped by normalized query so similar saved chases share source calls.
- Requests are centrally rate-limited across OAuth, Browse search, Browse item detail, Shopping fallback, and Finding fallback paths.
- Production currently uses `EBAY_MAX_REQUESTS_PER_MINUTE=6`, `EBAY_MIN_REQUEST_GAP_MS=10000`, and `EBAY_BACKOFF_BASE_SECONDS=900`.
- Browse rate-limit responses trigger backoff and do not immediately fall through into legacy Finding calls.
- Discovery is cache-first and does not depend on live eBay calls to render user-facing recommendations.
- Market context for Discovery is cached and refreshed in the background only for visible suggestions.
- Listing alerts are deduplicated by listing/source and capped per chase per poll.
- Users control alert volume, minimum match score, currency, shipping country, and listing source preferences.
- Vaultr includes a Marketplace Account Deletion notification endpoint and records deletion notifications for compliance.

The requested growth is intended to support legitimate user chase monitoring and Pro market context while preserving conservative request behavior. We are not seeking to bypass rate limits; we want appropriate production capacity for a compliant application that already implements throttling, caching, dedupe, and backoff.

Thank you for reviewing.

## App Behavior Details

- Primary API: eBay Browse API.
- Optional fallback: legacy Finding / Shopping only when configured and not after a Browse rate-limit response.
- Marketplace: usually `EBAY_US`.
- Search cadence: runtime poll tick is typically 5 minutes; per-user plan intervals control chase eligibility.
- Free chases: checked no more often than every 30 minutes.
- Pro chases: checked no more often than every 15 minutes.
- Similar active chases are grouped so source requests do not scale one-to-one with user count.
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
- Discovery market cache in SQLite.
- Reference card images are sourced outside eBay where possible.
- eBay market reads are optional supporting context, not the core Discovery source.

## Current Production Throttle Settings

```text
EBAY_MAX_REQUESTS_PER_MINUTE=6
EBAY_MIN_REQUEST_GAP_MS=10000
EBAY_BACKOFF_BASE_SECONDS=900
```

## Evidence To Mention If Asked

Recent local evidence did not indicate exhaustion of a 5,000/day Browse quota. The observed failures were a small number of `RATE_LIMITED` cache rows, suggesting short-window, endpoint, or app-check throttling rather than high daily volume.
