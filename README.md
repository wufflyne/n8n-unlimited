# n8n-unlimited

A clean fork of [n8n](https://github.com/n8n-io/n8n) (v26.7.0) with **all locally-available Enterprise features unlocked out of the box** — no license, no activation, no phone-home, no clutter.

- 🔓 Every local Enterprise feature works immediately after install
- 🕵️ No telemetry, no promo banners, no license/plan/usage pages
- 📦 Ready-to-run Docker image + `docker-compose.yml`

## What's unlocked

| Category | Features |
|---|---|
| Auth & security | SAML SSO, OIDC SSO, LDAP, SCIM provisioning API, MFA enforcement, external secrets (Vault / AWS / GCP / Azure / Infisical), data redaction, personal space policy |
| Collaboration | Sharing, folders, instance variables, advanced permissions, custom roles, project roles (admin/editor/viewer), workflow diffs, named versions, workflow reviews |
| Ops | Source control (Git sync), Git connections/promotions, log streaming, worker view & pools, multiple main instances, advanced execution filters, debug in editor, binary/execution data in external S3/Azure, custom npm registry for community nodes, type availability policies, API key scopes, token exchange |
| AI | AI Assistant, Ask AI, AI Builder — local mode with your own provider key |
| Quotas | Users, active workflows, variables, team projects, workflow history, evaluations — all unlimited |

## What's removed

- License activation / renewal / management (no calls to `license.n8n.io`, `enterprise.n8n.io`, `subscription.n8n.io`)
- Telemetry / PostHog (backend + frontend), internal dev-metrics
- Dynamic promo banners, version notifications, hiring banner
- "Usage & Plan" settings page, upgrade prompts, non-production banner
- AI credits / usage-based cloud billing (only features tied to n8n's own cloud are gone)

Free cloud metadata (workflow templates, community node registry) remains, purely optional.

## Deploy with Docker Compose

```bash
git clone https://github.com/wufflyne/n8n-unlimited.git
cd n8n-unlimited
docker compose up -d
```

Open `http://<server-ip>:5678` and create the owner account. Done — everything is unlocked.

### Recommended environment

The bundled `docker-compose.yml` covers the basics. Useful variables:

```yaml
environment:
  - N8N_SECURE_COOKIE=false        # if you access n8n over plain HTTP by IP
  - N8N_HOST=n8n.example.com       # your hostname
  - WEBHOOK_URL=https://n8n.example.com/  # for webhooks behind a reverse proxy
  - N8N_ENCRYPTION_KEY=...         # fixed key so backups/restores keep credentials readable
  - N8N_AI_ANTHROPIC_KEY=sk-...    # optional: AI Assistant / Ask AI / AI Builder with your own key
  - N8N_PROXY_HOPS=1               # behind a reverse proxy
volumes:
  - n8n_data:/home/node/.n8n       # SQLite DB, credentials, config
  - ./local-files:/files           # files visible to workflows
```

Behind HTTPS (reverse proxy with TLS), keep `N8N_SECURE_COOKIE` on (default).

### Run the prebuilt image without compose

```bash
docker volume create n8n_data
docker run -d --name n8n -p 5678:5678 \
  -e N8N_SECURE_COOKIE=false \
  -v n8n_data:/home/node/.n8n \
  <image>
```

## Build the image yourself

```bash
pnpm install          # pnpm 12, Node.js 26
pnpm build:docker     # produces n8nio/n8n:local and n8nio/runners:local
```

Works with Docker or Podman (`CONTAINER_ENGINE=podman`). Then load it into your registry or export with `docker save`.

## How the unlock works

The license layer (`packages/cli/src/license.ts`) is rewritten as a local, always-on provider:

- `isLicensed(feature)` → `true` for every feature except cloud-billing flags
- all quotas → unlimited, plan reported as `Enterprise`
- the `@n8n_io/license-sdk` manager is never instantiated — zero license-server calls
- EE modules (`licenseFlag`) load unconditionally

Everything else is stock n8n, so community nodes, templates import, and all standard workflows behave exactly as upstream.

## Project layout

```
docker-compose.yml      one-command deployment
docker/                official image build (Dockerfile + bake)
packages/              n8n source (cli, editor-ui, nodes-base, nodes-langchain, @n8n/*)
scripts/               build tooling (build-n8n.mjs, dockerize-n8n.mjs)
patches/, LICENSE.md    upstream patch set and licenses
```

## License

Based on upstream n8n — fair-code under the [Sustainable Use License](LICENSE.md) and [n8n Enterprise License](LICENSE_EE.md). This fork is for personal self-hosted use.
