# Production web deployment

KeepSeek's production web process uses the existing production database and catalog in `/home/pi/Documents/GitHub/vaultr`. It must never load staging data.

## Prerequisites

Before installing or restarting the service:

1. Create or select a stable public HTTPS hostname in the existing Cloudflare account.
2. Route that hostname through the existing tunnel to `http://127.0.0.1:8790`. Preserve all unrelated ingress routes.
3. Register the exact Discord OAuth callback in the production Discord application:

   ```text
   https://PRODUCTION-HOST/auth/discord/callback
   ```

4. Set these non-secret production values in `/home/pi/Documents/GitHub/vaultr/.env`:

   ```text
   DATABASE_PATH=./data/vaultr.db
   VAULTR_WEB_BASE_URL=https://PRODUCTION-HOST
   VAULTR_WEB_HOST=127.0.0.1
   VAULTR_WEB_PORT=8790
   VAULTR_WEB_POST_LOGIN_REDIRECT_PATH=/app
   VAULTR_WEB_PREVIEW=false
   ```

The production unit sets `VAULTR_ENVIRONMENT=production`. Startup refuses preview mode, quick-tunnel origins, non-loopback binding, another port, or another database path.

## Backup and build

Use the supported online backup and verify it before restarting processes:

```bash
cd /home/pi/Documents/GitHub/vaultr
node dist/backup.js
sqlite3 -readonly data/backups/LATEST.db 'PRAGMA quick_check;'
npm run build
```

## Install and cut over

Install both units before moving scheduler ownership away from the bot:

```bash
sudo install -m 0644 deploy/vaultr-web.service /etc/systemd/system/vaultr-web.service
sudo install -m 0644 deploy/vaultr-discovery-scheduler.service /etc/systemd/system/vaultr-discovery-scheduler.service
sudo systemctl daemon-reload
sudo systemctl restart vaultr.service
sudo systemctl enable --now vaultr-discovery-scheduler.service
sudo systemctl enable --now vaultr-web.service
```

Restarting the updated bot before starting the scheduler prevents duplicate scheduler loops. Durable preparation leases remain the final concurrency fence.

Do not stop the bot: it still owns listing polling and optional opted-in Discord card-alert delivery.

## Bounded verification

```bash
systemctl is-active vaultr.service vaultr-web.service vaultr-discovery-scheduler.service
systemctl show vaultr-web.service -p MainPID -p ActiveEnterTimestamp
ss -ltnp | grep '127.0.0.1:8790'
curl -fsS http://127.0.0.1:8790/api/auth/config
journalctl -u vaultr-web.service -u vaultr-discovery-scheduler.service -n 80 --no-pager
```

Then verify through the public hostname:

- `/app`, `/app.js`, `/app.css`, `/api/auth/config`, and `/auth/discord` reach the Node service;
- API and authentication responses include `Cache-Control: no-store`;
- the OAuth redirect URI exactly matches the registered callback;
- the existing Discord identity resolves to the same internal account;
- Watchlist, Pickups, Inbox counts, plan, settings, and current Display Case agree with the read-only database baseline.

Do not force a Display Case refresh as part of deployment. Report a historical or partial current case truthfully.
