# Writable Web Staging

Vaultr staging runs the real web application against isolated writable storage. It does not start the Discord bot, listing poller, Discovery scheduler, market worker, webhook listener, or email outbox worker.

## External prerequisite

Create a separate Discord application for staging. Add this exact redirect URI, using the staging tunnel origin:

```text
https://STAGING-PUBLIC-HOST/auth/discord/callback
```

Use that application's client ID and secret only in the staging environment. Staging and production must use different public hostnames; cookies are also namespaced `staging` as a second isolation boundary.

## Prepare

Run staging build and deployment commands from the dedicated checkout:

```bash
cd /home/pi/Documents/GitHub/vaultr-staging
```

```bash
mkdir -p ~/.config/vaultr
install -m 0600 deploy/vaultr-staging.env.example ~/.config/vaultr/staging.env
${EDITOR:-nano} ~/.config/vaultr/staging.env
mkdir -p ~/.local/share/vaultr-staging/{data,catalog,logs}
```

Set the real production paths/origin for overlap detection, the staging public origin, and the separate Discord credentials. Leave all Postmark variables unset.

Initialize the separate public card catalog without copying user data:

```bash
set -a
source ~/.config/vaultr/staging.env
set +a
npm run catalog:init
npm run catalog:import:curated
# Optional broader local search coverage:
npm run catalog:import:tcgdex -- /home/pi/Documents/GitHub/cards-database
npm run catalog:import:pokemontcg -- /home/pi/Documents/GitHub/pokemon-tcg-data
```

The application database is created through normal startup migrations. It starts with no production accounts, identities, sessions, Chases, Inbox items, or Shelf history.

## Install and start

```bash
npm run build
sudo cp deploy/vaultr-staging-web.service /etc/systemd/system/vaultr-staging-web.service
sudo systemctl daemon-reload
sudo systemctl enable --now vaultr-staging-web
sudo systemctl status vaultr-staging-web
tail -f ~/.local/share/vaultr-staging/logs/web.log
```

No production service needs to be restarted.

## Tunnel

For a stable Cloudflare named tunnel mapped to the staging hostname:

```bash
cloudflared tunnel --url http://127.0.0.1:8791 run vaultr-staging
```

Set `VAULTR_WEB_BASE_URL` to that public HTTPS origin and register the matching Discord callback shown above. A quick tunnel can be used temporarily with `cloudflared tunnel --url http://127.0.0.1:8791`, but its changing hostname requires updating both settings before OAuth will work.

## Manual check

1. Confirm the page visibly says **Staging**, then sign in through the staging Discord application.
2. Sign in with a separate Discord test account that has never used the staging Discord application. This creates an isolated empty staging account through the normal OAuth path; no reset or login bypass is needed.
3. Verify the new staging account enters Welcome onboarding; set shipping and add the first card to the Watchlist.
4. In Settings, save matching/shipping changes and confirm a currency change converts saved staging Watchlist budgets.
5. In Watchlist, edit, pause, resume, complete, and watch the card again.
6. Confirm Home, Inbox, and Discover first-use states are accurate, then use **Revisit setup** in Settings and confirm the account remains completed after exit.

Inbox review/dismiss can be tested only after a later controlled staging worker creates genuine staging matches. Email login, email delivery, Discord DMs, polling, Discovery preparation, and fabricated match seeding are intentionally unavailable in this setup.

## Synthetic personalized Display Case

The operator-only fixture command can prepare a small personalized Display Case for one explicit staging account. It uses the normal persisted shelf and authenticated feedback API, contains no market estimates, and does not start workers or provider requests. It fails unless the full staging isolation configuration passes, the Discovery scheduler is disabled, and the selected account has no genuine prepared Display Case.

After building the staging checkout, find the internal account ID in the isolated staging database and run:

```bash
set -a
source "$HOME/.config/vaultr/staging.env"
set +a
sqlite3 -readonly "$DATABASE_PATH" "SELECT id, COALESCE(display_name, '') FROM users ORDER BY created_at;"
```

```bash
cd /home/pi/Documents/GitHub/vaultr-staging
VAULTR_STAGING_ENV_FILE="$HOME/.config/vaultr/staging.env" \
  npm run staging:discovery:dist -- --user 'usr_EXPLICIT_STAGING_ACCOUNT_ID'
```

Reload Home or Discover while signed into that same staging account. Verify **More like this**, **Not for me**, replacement feedback, and versioned **Undo** through the real UI. The fixture is idempotent for the current week and cannot affect another account.

Cleanup removes only fixture-marked shelves for that account and their associated fixture-card feedback:

```bash
VAULTR_STAGING_ENV_FILE="$HOME/.config/vaultr/staging.env" \
  npm run staging:discovery:dist -- --user 'usr_EXPLICIT_STAGING_ACCOUNT_ID' --cleanup
```

The visual application changes require a staging build and web-service restart after deployment. Creating or cleaning the fixture itself does not require a restart.
