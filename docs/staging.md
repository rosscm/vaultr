# Writable Web Staging

Vaultr staging runs the real web application against isolated writable storage. It does not start the Discord bot, listing poller, Discovery scheduler, market worker, webhook listener, or email outbox worker.

## External prerequisite

Create a separate Discord application for staging. Add this exact redirect URI, using the staging tunnel origin:

```text
https://STAGING-PUBLIC-HOST/auth/discord/callback
```

Use that application's client ID and secret only in the staging environment. Staging and production must use different public hostnames; cookies are also namespaced `staging` as a second isolation boundary.

## Prepare

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
2. Verify the new staging account enters Welcome onboarding; set shipping and create the first Chase.
3. In Settings, save matching/shipping changes and confirm a currency change converts saved staging Chase budgets.
4. In Vault, edit, pause, resume, complete, and reopen the Chase.
5. Confirm Home, Inbox, and Discover empty states are accurate for a fresh account.

Inbox review/dismiss can be tested only after a later controlled staging worker creates genuine staging matches. Email login, email delivery, Discord DMs, polling, Discovery preparation, and fabricated match seeding are intentionally unavailable in this setup.
