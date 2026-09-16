# Two-stage summaries
<!-- Modified by OtterHelm for this custom distribution; see deploy/local/README.md. -->

Enable with `AGENTMEMORY_TWO_STAGE_SUMMARY=true`; the default is off.

New observations are summarized in batches every 15 minutes without supplying the existing integrated summary. A rollup integrates pending chunks when four are available or one hour has elapsed since the first pending chunk was created. No additional calls are made when there are neither new observations nor pending chunks.

## Storage and retrieval

`mem:local-analysis:v1:summary-pipelines` stores the base summary, pending chunks, and prepared results awaiting persistence. `mem:summaries` immediately receives a read projection that distinguishes the base summary from later updates.

Context injection budgets each chunk separately. Search and expanded retrieval also expose pending chunks while preserving project, agent, and working-directory filters. Chunks from deleted sessions are not returned.

## Failures and recovery

Rollup failures retry at 15-minute intervals, up to three attempts, then pause new summary analysis for that session. Raw observations are retained and graph processing continues. At most eight pending chunks are allowed.

Manual changes to or deletion of the existing summary pause processing with a conflict instead of silently overwriting it. Do not reset conflicts or held work without review.

Successful API results are reused for storage retries. A forced process termination immediately after receiving a response can still cause a duplicate API call.

## Observability and cost

Health exposes `twoStageSummary`, `rollupPendingSessions`, `rollupBlockedSessions`, and `rollupCalls`. The usage `operation` distinguishes `delta` from `rollup`; these calls remain included in the existing summary and graph cost totals.

Rollups introduce additional calls, so savings are not guaranteed for every workload. Compare processed record counts, queue age, total input/output tokens, and preservation of meaning during operational validation.

## Scope and rollback

This feature does not backfill historical records, bulk-retry held records, or automatically exclude low-value observations.

Ordinary exports include the latest projected summary but not internal pipeline recovery state. Full recovery requires a backup of the entire data volume.

For rollback, disable the flag and use the previously verified pre-two-stage image, retaining the same volume. If summaries change while the feature is disabled, review the pipeline before re-enabling it because its saved projection may conflict with those changes.
