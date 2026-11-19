# Phase 3C eBay cleanup

This operator-only tool removes confirmed retained eBay marketplace content while preserving Inbox identities, collector actions, listing IDs, deduplication keys, and independently sourced card data. It does not delete rows. Scores, source ranks, and match explanations are retained and reported separately for policy review.

## Dry run

Dry run is the default and opens SQLite read-only:

```sh
npm run cleanup:ebay:phase3c -- --database /absolute/path/to/vaultr.db
```

The JSON report contains aggregate field counts before and projected after cleanup. It never prints account IDs, listing IDs, titles, or payloads.

## Apply procedure

1. Schedule a maintenance window and stop every process that can write to the application database. This includes web, polling, schedulers, workers, and operator commands.
2. Create a separate recovery checkpoint with the existing backup tooling. Keep it outside automatic pruning and do not overwrite an earlier protected checkpoint.
3. Validate the checkpoint with SQLite integrity and foreign-key checks. The cleanup command repeats these checks and refuses a checkpoint older than the database.
4. Run:

```sh
npm run cleanup:ebay:phase3c -- \
  --apply \
  --database /absolute/path/to/vaultr.db \
  --verified-backup /absolute/path/to/protected-phase3c-checkpoint.db \
  --maintenance-confirmed
```

Apply mode acquires an immediate SQLite write transaction. Any invalid JSON, preservation mismatch, foreign-key failure, integrity failure, or remaining targeted content rolls the entire transaction back. Repeating a successful cleanup is safe and reports zero remaining targeted fields.

## Post-cleanup checks

Keep writers stopped until all checks pass:

- Run the dry-run command again and confirm every targeted field count is zero.
- Confirm `PRAGMA integrity_check` returns `ok` and `PRAGMA foreign_key_check` is empty.
- Check aggregate Inbox row, reviewed, dismissed, and distinct listing-ID counts against the apply report.
- Confirm supported-shop alerts still retain their listing presentation.
- Exercise an existing Inbox deep link and review/dismiss action in a controlled environment.
- Confirm Display Case cards retain catalog artwork and show no stale eBay market snapshot.

## Rollback

If validation fails after commit, keep all writers stopped. Preserve the failed database for diagnosis, restore the verified checkpoint using the established database restore procedure, rerun SQLite integrity and foreign-key checks, then restart services in the normal controlled order.

Existing backups can still contain historical marketplace content. This tool does not alter them. Keep access restricted and inventory them under a later approved backup-retention policy. Manual, unknown-origin, and protected recovery checkpoints must not be silently made eligible for automatic pruning.
