# Production deployment

Rime runs as two Docker Compose services:

- `backend` scans the read-only `runtime/music` directory and stores SQLite data under `runtime/data`.
- `web` serves the built frontend and proxies `/api` and `/healthz` to the backend.

The public container port binds to `127.0.0.1:18081` by default so it can only be reached through a local reverse proxy or Cloudflare Tunnel.

## Manual deployment

```sh
./deployment/deploy.sh
```

Set `RIME_HTTP_PORT` to change the loopback port. Place the music library below `runtime/music` or replace that bind mount with an absolute read-only host path in `compose.yml`.

On the first deployment, open Rime and register the first account. It becomes
the administrator automatically, and public registration closes immediately.
Rime does not ship with a default username or password.

To recover an existing administrator password, stop the backend and run the
recovery command with the data volume mounted:

```sh
docker compose run --rm -T backend admin reset-password --username admin
```

## GitHub Actions deployment

The `CI and deploy` workflow validates backend tests, Go vet, and the frontend production build. Pushes to `main` deploy only after both validation jobs succeed.

Configure these repository secrets:

| Secret | Value |
| --- | --- |
| `DEPLOY_HOST` | Production SSH host |
| `DEPLOY_PORT` | Production SSH port |
| `DEPLOY_USER` | Production SSH user |
| `DEPLOY_SSH_KEY` | Private half of the dedicated deployment key |

The deployment checkout must exist at `~/apps/rime`. The SSH user needs access to Docker and `flock`. For least privilege, add the public deployment key to `~/.ssh/authorized_keys` with these options:

```text
restrict,command="/home/linxin/apps/rime/deployment/ssh-deploy.sh" ssh-ed25519 <public-key> rime-github-actions
```

The forced command only accepts `deploy <40-character-commit-sha>` and rejects interactive shells and arbitrary commands.
