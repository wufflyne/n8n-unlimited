# n8n-unlimited

This is [n8n](https://github.com/n8n-io/n8n) (v26.7.0) with all the locally-available Enterprise features turned on and everything license- and telemetry-related stripped out. No license key, no activation, no calls to n8n's servers about who you are or how you use it.

Maintained by [wufflyne](https://wufflyne.com).

## Why this fork exists

I run n8n at home for my own automations. The Community Edition is great, but a few things I wanted live behind the Enterprise wall: log streaming, external secrets, advanced permissions, workflow history longer than a couple of days, the AI Assistant. None of these need n8n's cloud — they're just feature flags in the code. So this fork flips them on permanently and stops asking.

Two honest caveats up front:

- Features that physically run on n8n's cloud (AI credits, usage-based billing) are not here. The AI features work in local mode with your own provider key.
- This is a personal-use fork under n8n's [Sustainable Use License](LICENSE.md) and [Enterprise License](LICENSE_EE.md). Don't build a SaaS on it and resell it — that's not what the license allows.

## What's unlocked

Everything that runs locally, from day one:

- **Auth**: SAML SSO, OIDC SSO, LDAP, SCIM provisioning API, MFA enforcement
- **Secrets**: external secret stores — Vault, AWS, GCP, Azure, Infisical
- **Collaboration**: sharing, folders, instance variables, advanced permissions, custom roles, workflow diffs, named versions, workflow reviews
- **Ops**: Git sync (source control), log streaming, worker view and pools, multiple main instances, advanced execution filters, debug-in-editor, binary/execution data in external S3/Azure, custom npm registry for community nodes, API key scopes
- **AI**: Assistant, Ask AI, AI Builder — local mode, your key, your bill
- **Quotas**: users, active workflows, variables, team projects, workflow history, evaluations — all unlimited

## What's removed

- License activation, renewal, management — zero calls to `license.n8n.io`, `enterprise.n8n.io`, `subscription.n8n.io`
- Telemetry (PostHog, backend and frontend) and internal dev-metrics
- Promo banners, version notifications, the hiring banner
- The "Usage & Plan" settings page and upgrade prompts
- Cloud billing / AI credits

Free cloud conveniences that still work because they're genuinely useful and optional: workflow templates and the community node registry.

## Quick start

Two ways to get running: pull the ready-made image (fast, no toolchain needed) or build it yourself from this repo (full control, works with Podman too).

### Option 1 — the prebuilt image

The image lives on Docker Hub as [`wufflyne/n8n-unlimited`](https://hub.docker.com/r/wufflyne/n8n-unlimited), tagged `stable` (tracks the latest release), `latest`, and the version it's based on (`26.7.0`). `amd64` only.

```bash
mkdir n8n && cd n8n

cat > docker-compose.yml <<'EOF'
services:
  n8n:
    image: wufflyne/n8n-unlimited:stable
    restart: unless-stopped
    ports:
      - "5678:5678"
    environment:
      - N8N_SECURE_COOKIE=false   # only for plain HTTP by IP; remove behind HTTPS
      - N8N_ENCRYPTION_KEY=change-me-to-a-long-random-string
    volumes:
      - n8n_data:/home/node/.n8n

volumes:
  n8n_data:
EOF

docker compose up -d
```

Open `http://<server-ip>:5678`, create the owner account, and you're running — everything is already unlocked.

To run it without compose:

```bash
docker volume create n8n_data
docker run -d --name n8n -p 5678:5678 \
  -e N8N_SECURE_COOKIE=false \
  -e N8N_ENCRYPTION_KEY=change-me-to-a-long-random-string \
  -v n8n_data:/home/node/.n8n \
  wufflyne/n8n-unlimited:stable
```

### Option 2 — build it yourself

Everything below assumes you're building; skip to the env table if you pulled the image.

### Environment variables worth setting

| Variable | Why |
|---|---|
| `N8N_ENCRYPTION_KEY` | Fixed key so credentials stay readable across restarts and restores. Without it a random one is generated and you can lose all saved credentials on a rebuild. **Back this up with the volume.** |
| `N8N_SECURE_COOKIE=false` | If you open n8n as `http://192.168.x.x:5678` (plain HTTP, no hostname), the login page eats itself with secure-cookie errors until you set this. Behind a reverse proxy with TLS, leave it on. |
| `N8N_PROXY_HOPS=1` | Set this when n8n sits behind a reverse proxy (nginx, Traefik, Caddy), so it trusts forwarded headers for the client IP. |
| `WEBHOOK_URL=https://n8n.example.com/` | The public URL webhooks should advertise. Without it, webhook nodes show `http://localhost:5678/...` URLs that outside services can't reach. |
| `N8N_HOST=n8n.example.com` | Your hostname, when you have one. |
| `N8N_AI_ANTHROPIC_KEY=sk-...` | Your own Anthropic key for the AI Assistant / Ask AI / AI Builder. Goes nowhere but your instance. |

### Building the image

```bash
git clone https://github.com/wufflyne/n8n-unlimited.git
cd n8n-unlimited
pnpm install        # Node.js >= 24, pnpm >= 12.4
pnpm build:docker   # produces n8nio/n8n:local and n8nio/runners:local
```

Podman works too: `CONTAINER_ENGINE=podman pnpm build:docker`. The build is heavy (editor-ui + all packages) — expect a while and a few GB of disk.

## Upgrades and backups

Everything that matters lives in one place: the `n8n_data` volume (`/home/node/.n8n` inside the container) — SQLite database, saved credentials, config. Back it up before anything else:

```bash
docker run --rm -v n8n_data:/data -v $(pwd):/backup alpine \
  tar czf /backup/n8n-data-$(date +%F).tar.gz -C /data .
```

To upgrade: back up, then `docker compose pull && docker compose up -d` — the `stable` tag tracks the latest release on Docker Hub. If you build from source instead, pull this repo and rebuild; check the commits for anything I had to re-apply — the license changes live in `packages/cli/src/license.ts` and occasionally upstream moves something underneath them.

## Troubleshooting

**Login page loads forever / "connection lost" over HTTP by IP.**
That's the secure cookie. n8n marks its session cookie `Secure` by default, so plain-HTTP-by-IP breaks it. Set `N8N_SECURE_COOKIE=false` and restart. If you can, give the instance a hostname and TLS instead — it's the cleaner fix.

**Webhook URLs say `localhost:5678`.**
n8n doesn't know it's behind a proxy. Set `WEBHOOK_URL=https://your-public-host/` and `N8N_PROXY_HOPS=1`.

**Credentials broke after a rebuild.**
The encryption key changed. Pin `N8N_ENCRYPTION_KEY` in the environment and keep it with your volume backups; the volume without the key (or the key without the volume) is useless.

**A node or template doesn't work.**
Everything outside the license layer is stock n8n, so community nodes, template imports and standard workflows behave exactly like upstream. If something in the Enterprise features misbehaves, that's on this fork — open an issue.

## How the unlock actually works

The license layer (`packages/cli/src/license.ts`) is replaced with a local, always-on provider:

- `isLicensed(feature)` returns `true` for every feature except cloud-billing flags
- all quotas are unlimited; the plan is reported as `Enterprise`
- the `@n8n_io/license-sdk` manager is never instantiated, so there are no license-server calls at all
- EE modules (`licenseFlag`) load unconditionally

## Repo layout

```
docker/          image build (Dockerfiles, bake config)
packages/        n8n source — cli, editor-ui, nodes-base, @n8n/* modules
scripts/         build tooling (build-n8n.mjs, dockerize-n8n.mjs)
patches/         upstream dependency patches
LICENSE.md, LICENSE_EE.md    licenses
```

## License

Upstream n8n is fair-code under the [Sustainable Use License](LICENSE.md); Enterprise parts under the [n8n Enterprise License](LICENSE_EE.md). This fork keeps both and is intended for personal self-hosted use.
