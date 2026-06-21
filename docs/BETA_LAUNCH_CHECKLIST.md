# Beta Launch Checklist

Use this as the working checklist before each invite wave. Keep support-server setup separate until that channel exists.

## User-Facing Readiness

- `/start` shows concrete chase examples and points users to one first action.
- `/help` is grouped by user intent, not only command names.
- `/chase add` tells users whether the chase name is specific or likely broad.
- Empty Vault states explain what to do next and that quiet days are normal.
- Vault Pulse posts on quiet active days so the bot does not look broken.

## Operations Gate

- `npm run smoke` passes before every deploy.
- `VAULTR_OPS_ALERT_DRY_RUN=true npm run ops:check` passes before invite waves.
- `/health` shows no active chase over 4x its plan interval during normal eBay availability.
- Discovery worker queue has no stale running jobs and no unexplained failures.
- Backups are current and restore path is understood.

## eBay Growth Evidence

- Record beta user count, active chase count, and average active chases per user.
- Track source calls, deferred source groups, and worst overdue chase daily.
- Keep eBay result windows and enrichment caps within smoke-check limits.
- Keep Discovery market reads cache-first and background-worker driven.

## Public Launch Blockers

- Stripe subscription lifecycle is integrated before selling Pro publicly.
- Privacy/terms pages are published before broad public invites.
- eBay application growth request is submitted or quota headroom is otherwise verified.
- Public launch remains gated on sustained chase freshness and clean ops checks.