# Custom local deployment
<!-- Modified by OtterHelm for this custom distribution; see deploy/local/README.md. -->

This fork is based on Agentmemory 0.9.29 and retains the upstream license and copyright notices. The customizations are available on `main`; `codex/public-incremental-ko` is the existing development branch.

See [Adaptive analysis](ADAPTIVE-ANALYSIS.md) for batch-size recovery and [Two-stage summaries](TWO-STAGE-SUMMARY.md) for optional staged summarization. Enable the latter explicitly with `AGENTMEMORY_TWO_STAGE_SUMMARY=true`.

## Features and configuration

- `AGENTMEMORY_INCREMENTAL_ANALYSIS=true` batches new observations per session for summary and graph analysis every 15 minutes.
- Completed records are not repeatedly analyzed. Historical records are not automatically backfilled. Pending summary chunks can still trigger a rollup without new observations.
- Summary batches contain up to 40 observations or 24,000 characters; graph batches contain up to 5 observations or 6,000 characters. Remaining work waits for a later cycle.
- Per-stage fingerprints, saved results, bounded retries, and held problem records reduce duplicate calls.
- Raw observations are retained, and previous summaries are archived separately.
- Existing 30-minute schedules are migrated once to the 15-minute policy.
- The English/Korean language selector changes viewer labels only. Stored memory content is not translated.

```env
AGENTMEMORY_INCREMENTAL_ANALYSIS=true
AGENTMEMORY_INJECT_CONTEXT=true
AGENTMEMORY_AUTO_COMPRESS=false
GRAPH_EXTRACTION_ENABLED=true
CONSOLIDATION_ENABLED=false
AGENTMEMORY_GRAPH_NONTHINKING=true
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-flash
OPENAI_REASONING_EFFORT=low
MAX_TOKENS=4096
```

Supply API keys through a local environment file outside the repository or a secret manager. Non-thinking mode applies only to incremental graph calls through the direct DeepSeek API; summaries retain their separate policy.

Records selected for analysis are sent to the external API. Review data-handling requirements before sending sensitive content. Token-based costs are estimates and may differ from provider billing. There is no hard monthly budget cutoff.

## Build and verification

Install dependencies from the repository root, then run `deploy/local/build.ps1`. This script requires the existing local base image **`agentmemory-local:0.9.29`**. Cloning the fork does not restore that image or operational data. The build intentionally fails if the base image has an unexpected CLI chunk layout.

The build helper currently produces the historical tag `agentmemory-local:0.9.29-incremental-ko6`. Deployment may use a commit-specific tag instead; select that tag explicitly in your local Compose configuration. Image tags and existing branch names are identifiers, not document language settings.

The lockfile is not committed under the inherited repository policy, so rerun tests after reinstalling dependencies.

```sh
npm install --ignore-scripts --no-audit --no-fund
npm test
```

`Test.Dockerfile` supports isolated Linux tests using a locally generated lockfile. `normalize-test-files.mjs` normalizes line endings only in the `/verify` test copy. `scripts/localize-viewer.mjs` records the initial UI transformation; do not rerun it against already transformed HTML.

## Operational safety

- Preserve the existing persistent volume. Never attach multiple analysis workers to the same volume.
- Updating source does not deploy it. Test separately before replacing the running image.
- Keep volumes, backups, keys, environment files, and diagnostic output out of Git.
- Replacing containers is not the same as deleting volumes. Do not use `docker compose down -v`.
- Test restoration on a separate volume; do not overwrite production data with a backup.
- The storage engine flushes periodically. Forced termination can lose recent writes or cause duplicate API calls.
- Graph writes span multiple steps and may require consistency checks after storage failures.

## Public history policy

The public customization history starts with reviewed code snapshots on top of upstream. It excludes private development history, operational diagnostic scripts, real session identifiers, personal paths, and data backups.

Do not merge private development branches directly or publish with `git push --all` or `--mirror`. Push only explicitly reviewed public refs.
