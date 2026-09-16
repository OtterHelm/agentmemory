# Failure classification and adaptive batching
<!-- Modified by OtterHelm for this custom distribution; see deploy/local/README.md. -->

This feature retains the 15-minute interval, summary limits of 40 observations / 24,000 characters, graph limits of 5 observations / 6,000 characters, and the policy of no hard budget cutoff.

- Truncated output reduces the batch limit. Every three consecutive successful full batches double that limit, up to the stage maximum.
- Format errors temporarily split only the failed records, without lowering the default throughput for unrelated records.
- Temporary splits exclude completed, held, or deleted records. Raw observations and completion fingerprints are preserved.
- Errors reset the success streak. Previously held records are not automatically reanalyzed.
- Optional `successStreak` and `isolation` state fields preserve progress across restarts without adding a KV scope.
- Failed-response usage records add only a classified `failureCode`, distinguishing a missing title, missing narrative, narrative shorter than 20 characters, and schema errors.
- Provider error bodies are not retained. Errors are converted to allowlisted codes such as HTTP status or timeout.
- Health fields `adaptiveBatching` and `failureCounts` expose activation and subsequent failure distribution. Older unclassified failures appear as `legacy_unspecified`.

Validation is not relaxed, and this feature does not change reasoning mode or output limits. Historical format failures cannot be diagnosed precisely without their original responses; use the new failure codes for follow-up investigation.

A mocked regression test processes 100 records in 16 calls when starting at a batch limit of one, instead of 100 calls without recovery. This is not a measured guarantee of token savings, cost savings, or summary quality.

Back up data before deployment and preserve the existing volume. To roll back, select the previously verified image without deleting the volume. Keep operational paths, keys, raw memories, and real session identifiers out of public artifacts.
