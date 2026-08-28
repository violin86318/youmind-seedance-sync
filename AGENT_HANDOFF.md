# Agent Handoff

## 1. Project identity

- Project name: `youmind-seedance-sync`
- Repo root: `/Users/wanglingwei/Library/Mobile Documents/com~apple~CloudDocs/~Vibe-Coding/Codex/Youmind`
- Purpose:
  1. Fetch public Seedance prompts from YouMind public endpoints.
  2. Sync normalized prompt records into Feishu/Lark Base.
  3. Build a static searchable site from Feishu-first data, with public-snapshot fallback.
  4. Mirror video assets to Cloudflare R2 and serve them through a gated Worker.
  5. Maintain an additional local dataset for `@aimikoda` Seedance prompts.

Primary overview: [README.md](./README.md)

## 2. Current repository map

### Core app areas

- `scripts/`
  - Fetching, Feishu sync, site build, R2 sync, bootstrap, analysis.
- `scripts/lib/`
  - Shared config, prompt normalization, source loading, video mirror helpers, CLI wrappers.
- `site/`
  - Static frontend (`index.html`, `app.js`, `styles.css`).
- `workers/seedance-site/`
  - Worker that fronts the deployed static site on custom domain.
- `workers/r2-video-gate/`
  - Worker that gates R2-hosted video access by Origin/Referer.
- `analysis/`
  - Prompt framework research and generated analysis artifacts.
- `data/`
  - Local generated datasets, including `aimikoda-seedance/`.

### Important generated/local data

- Main prompt snapshot:
  - `data/prompts.zh-CN.json` is referenced in docs and analysis.
- Aimikoda dataset:
  - [data/aimikoda-seedance/README.md](./data/aimikoda-seedance/README.md)
  - [data/aimikoda-seedance/records.json](./data/aimikoda-seedance/records.json)
  - `data/aimikoda-seedance/media/` contains mirrored jpg/mp4 assets.

Current `data/` size on disk: about `38M`.

## 3. Data flow

### Main Seedance sync pipeline

1. `scripts/fetch-prompts.mjs`
   - Uses `loadOrFetchPromptPayload()` from `scripts/lib/prompt-source.mjs`.
   - Writes local snapshot into `data/prompts.<locale>.json`.
   - Supports cache preference and stale-cache fallback.

2. `scripts/sync-feishu-lark.mjs`
   - Reads prompt payload.
   - Normalizes prompts via `normalizePromptToRow()`.
   - Uses `lark-cli` to upsert changed rows into Feishu Base.
   - Deactivates rows missing from upstream snapshot.

3. `scripts/build-site.mjs`
   - Uses `loadSitePayloadForBuild()` from `scripts/lib/site-source.mjs`.
   - Prefers Feishu readback for final site payload.
   - Falls back to public snapshot if Feishu read/validation fails.
   - Outputs `site/data/prompts.json`.

4. `site/`
   - Pure static site consuming `site/data/prompts.json`.

5. `scripts/sync-r2-videos.mjs`
   - Mirrors upstream/original videos into Cloudflare R2.
   - Updates Feishu mirror fields.
   - Uses manifest and public URL generation helpers from `scripts/lib/video-source.mjs`.

### Additional Aimikoda collector

- `scripts/collect-aimikoda-seedance.mjs`
  - Collects public `@aimikoda` Seedance prompts from mirrored public sources.
  - Writes normalized dataset to `data/aimikoda-seedance/records.json`.
  - Downloads preview image/video files into `data/aimikoda-seedance/media/`.

## 4. Key commands

Defined in [package.json](./package.json).

### Main project

```bash
npm run fetch
npm run sync:lark
npm run sync:api
npm run build:site
npm run sync:r2
npm run prepare:site
```

### Bootstrap / infra

```bash
npm run bootstrap:lark
npm run setup:runner
npm run setup:r2
npm run deploy:video-gate
npm run deploy:seedance-site
npm run set:r2-public-url
npm run rewrite:r2-urls
npm run disable:r2-dev-url
```

### Analysis / side dataset

```bash
npm run analyze:prompts
npm run analyze:prompts:stable
npm run collect:aimikoda-seedance
```

## 5. Config and environment model

Primary config logic: [scripts/lib/config.mjs](./scripts/lib/config.mjs)

### Local/global config files

- Local repo config:
  - `.seedance.local.json`
- Global config:
  - `~/.config/youmind-seedance-sync/config.json`
- Global R2 manifest default:
  - `~/.config/youmind-seedance-sync/r2-videos.json`

### Important env vars

#### Feishu / sync target

- `FEISHU_BASE_TOKEN`
- `FEISHU_TABLE_ID`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `YOUMIND_MODEL`
- `YOUMIND_LOCALE`

#### Prompt cache / fetch behavior

- `YOUMIND_CACHE_DIR`
- `YOUMIND_MAX_CACHE_AGE_HOURS`
- `YOUMIND_ALLOW_STALE_CACHE_ON_ERROR`
- `YOUMIND_FORCE_REFRESH`

#### R2

- `YOUMIND_R2_ENABLED`
- `YOUMIND_R2_BUCKET`
- `YOUMIND_R2_PUBLIC_URL_BASE`
- `YOUMIND_R2_KEY_PREFIX`
- `YOUMIND_R2_MANIFEST_PATH`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_URL_BASE`

#### Worker / deploy

- `CLOUDFLARE_API_TOKEN`
- `SITE_ORIGIN` for `seedance-site` Worker
- `ALLOWED_ORIGINS`, `ALLOW_LOCAL_PREVIEW`, `ALLOW_EMPTY_REFERER`, `ALLOWED_KEY_PREFIXES` for `r2-video-gate`

## 6. Deployment topology

### Static site

- Static frontend lives in `site/`.
- Custom domain worker config:
  - [workers/seedance-site/wrangler.toml](./workers/seedance-site/wrangler.toml)
- Current route:
  - `seedance.beyondmotion.net`
- Current upstream origin:
  - `https://seedance-site.pages.dev` (Pages project `seedance-site` in the Violinpearson account)
- Prompt data:
  - `site/data/prompts.json` is uploaded to R2 bucket `seedance-data` (key `data/prompts.json`)
  - The Worker serves `/data/prompts.json` directly from R2, bypassing the Pages 25 MiB single-file limit

### Video gateway

- Worker config:
  - [workers/r2-video-gate/wrangler.toml](./workers/r2-video-gate/wrangler.toml)
- Current R2 bucket:
  - `violin86318-youmind-seedance-videos`
- Allowed origins currently include:
  - `https://violin86318.github.io`
  - `https://seedance.beyondmotion.net`

## 7. Research and analysis materials

- High-level prompting framework and source references:
  - [analysis/seedance-framework.md](./analysis/seedance-framework.md)
- Generated analysis data:
  - [analysis/prompt-analysis.json](./analysis/prompt-analysis.json)

This is the best entry point for any agent working on prompt taxonomy, prompt-builder UX, or prompt-structure extraction.

## 8. Current local changes not committed

`git status --short` currently shows:

- Modified:
  - `package.json`
  - `scripts/sync-r2-videos.mjs`
- Untracked:
  - `data/`
  - `scripts/collect-aimikoda-seedance.mjs`

### What these changes are

1. `package.json`
   - Adds `collect:aimikoda-seedance` script.

2. `scripts/sync-r2-videos.mjs`
   - Adds duplicate-safe handling for Feishu mirror field creation.
   - New helper `isFieldAlreadyExistsError(...)`.
   - `ensureMirrorFields(...)` now catches `validation_error` for already-existing fields and continues.

3. `scripts/collect-aimikoda-seedance.mjs`
   - New script to build a separate local dataset for public `@aimikoda` Seedance materials.

4. `data/aimikoda-seedance/`
   - Generated dataset plus mirrored media files.

These changes are functional but not yet committed. Incoming agent should decide whether to keep, refine, or exclude them before any release or deployment work.

## 9. Known external dependencies

- YouMind public prompt endpoints
- `lark-cli`
- Feishu/Lark Base
- Cloudflare Wrangler / R2 / Workers
- Possible GitHub Pages / Cloudflare Pages deployment outside repo state

This repo does not currently expose full CI workflow files in the visible tree. If an incoming agent needs to modify automation, they should verify whether workflow definitions are stored outside the current checkout or omitted from this workspace.

## 10. Practical handoff priorities

If another agent is taking ownership, the recommended order is:

1. Read [README.md](./README.md)
2. Read [AGENT_HANDOFF.md](./AGENT_HANDOFF.md)
3. Inspect [package.json](./package.json)
4. Inspect:
   - `scripts/fetch-prompts.mjs`
   - `scripts/sync-feishu-lark.mjs`
   - `scripts/build-site.mjs`
   - `scripts/sync-r2-videos.mjs`
   - `scripts/lib/config.mjs`
5. Inspect site/runtime:
   - `site/index.html`
   - `workers/seedance-site/src/index.js`
   - `workers/r2-video-gate/src/index.js`
6. Decide how to handle current uncommitted Aimikoda-related changes.

## 11. Suggested takeover prompt for another agent

Use this as the initial instruction to the next agent:

```text
You are taking over the `youmind-seedance-sync` project.

Start by reading:
1. README.md
2. AGENT_HANDOFF.md

Then inspect:
- package.json
- scripts/fetch-prompts.mjs
- scripts/sync-feishu-lark.mjs
- scripts/build-site.mjs
- scripts/sync-r2-videos.mjs
- scripts/lib/config.mjs
- site/index.html
- workers/seedance-site/src/index.js
- workers/r2-video-gate/src/index.js

Important current local state:
- package.json is modified
- scripts/sync-r2-videos.mjs is modified
- scripts/collect-aimikoda-seedance.mjs is untracked
- data/aimikoda-seedance/ is untracked and contains generated media/data

Your first task is to confirm:
1. whether these local changes should be retained,
2. whether the main Seedance sync/build/deploy pipeline is still coherent,
3. what the next highest-value work item is.
```

## 12. Open questions for the next agent

1. Should `data/aimikoda-seedance/` remain in this repo, or move to a separate archive repo/dataset directory?
2. Should the Aimikoda collector be treated as project scope, or as a one-off side utility?
3. Is the `scripts/sync-r2-videos.mjs` duplicate-field fix sufficient, or should field creation become fully idempotent with a stronger schema reconciliation step?
4. Are CI/deployment workflow files intentionally absent from this checkout, or missing from the workspace snapshot?
