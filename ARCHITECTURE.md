# Vaultr Account Architecture

Vaultr has a first-class internal account identity. Product data belongs to the Vaultr account, not to a Discord snowflake.

## Accounts

`users.id` is an opaque Vaultr account ID. Current IDs use the `usr_` prefix plus a UUID so they are platform-neutral and visibly distinct from provider IDs.

Account-owned product state includes Chases, alert settings, plans, alert events, delivery rows, Discovery state, Weekly Shelf state, feedback, taste memory, and related history.

## Linked Identities

`user_identities` stores external identities linked to a Vaultr account. The only implemented provider today is `DISCORD`.

Discord is an authentication provider, linked identity, optional notification channel, and optional command interface. It is not the primary account ID.

The identity model is intentionally provider-shaped so Google and email identities can be added later without changing product ownership tables.

## Web Flow

Current web sign-in uses Discord OAuth:

1. Discord OAuth returns the Discord user profile.
2. Vaultr resolves or creates the linked Vaultr account.
3. `web_sessions.user_id` stores the internal Vaultr account ID.
4. Web APIs read product data by Vaultr account ID.

The web inbox reads `alert_events` directly. It does not require a Discord delivery row.

## Discord Flow

Discord commands resolve:

Discord user ID -> `DISCORD` linked identity -> Vaultr account ID

After that boundary, product operations use the Vaultr account ID. Discord-only operations, such as sending a DM, resolve the linked Discord provider ID explicitly.

## Alert Delivery

Alert matching creates or updates an `alert_event` for the Vaultr account. Delivery channels are separate rows.

For a Discord-linked account:

`alert_event` -> `DISCORD_DM` delivery -> linked Discord provider user ID -> Discord API

For a future account without Discord:

`alert_event` still exists and is visible in the web inbox. No Discord delivery is required.
