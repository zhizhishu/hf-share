# hf-share

All-in-one monorepo for the four-service Hugging Face Space deployment (`alphaeee/claw`), assembling Search/MCP, Email, Subscription Workspace, and the external private iCloud HME engine into a single Docker image published to `ghcr.io/zhizhishu/hf-share`.

## Repository Layout

```text
hf-share/
├─ components/
│   ├─ fusionsearch-mcp/   # Aggregated Search / MCP / Admin UI / container entrypoint (/, /admin, /mcp, /api, /status)
│   ├─ clawemail/          # Email web panel & canonical /ext/* API (/clawemail)
│   └─ cloudspace/         # Subscription workspace gateway, cover, and build-time rebrand scripts (/cloudspace)
├─ public/entry/           # Root 3D ocean landing page (/)
├─ docs/                   # Utility scripts (e.g. perplexity-token-sync.user.js)
├─ scripts/bump-lock.py    # Offline revision lock tool for external private engine
├─ repos.lock              # Pinned commit SHA for external private repo (ICLOUD_HME_SHA)
├─ Dockerfile              # Multi-stage all-in-one image build (BuildKit secret for private fetch)
└─ .github/workflows/      # GHCR image publish (path-filtered) & smoke test
```

## External Private Repositories (Kept Separate)

- `zhizhishu/icloud-hme` (private, branch `claw-gate`): Go iCloud HME engine fetched securely at Docker build time via BuildKit secret `icloud_hme_pat`, pinned by `ICLOUD_HME_SHA` in `repos.lock`.
- `zhizhishu/cloudspace-netcollect` (private): Independent GitHub Actions pipeline pushing subscription artifacts to private gists; not bundled into this image.

## History & Migration Note

On 2026-11-23, the three public component repositories (`zhizhishu/fusionsearch-mcp`, `zhizhishu/ClawEmail`, and `zhizhishu/cloudspace`) were consolidated into `components/` via full-history merge (no squash), preserving all original commit histories and attribution.

## Build & Release

1. Edit any public component directly under `components/` and push to `main`.
2. If the private `icloud-hme` engine updated, run `python scripts/bump-lock.py` (reads local `private/icloud-hme` tracking ref) and commit `repos.lock`.
3. GitHub Actions (`Publish Docker Image`) builds `linux/amd64` and pushes `ghcr.io/zhizhishu/hf-share:latest` + `sha-<commit>`.
4. Trigger a **factory reboot** on the target Space to pull the updated image.
