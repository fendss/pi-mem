# Qdrant Hybrid Failure Matrix

Stage 6 treats SQLite as the immutable source of truth and fails closed whenever
Qdrant readiness, scope, generation, or provenance cannot be verified.

| Failure | Required behavior | Automated coverage |
| --- | --- | --- |
| Process exits with leased outbox rows | Expired leases return to `pending`; stable point IDs make replay idempotent | SQLite close/reopen lease recovery test |
| Transient Qdrant upload failure | Release the batch to `pending`; keep the generation resumable | Synchronizer retry test |
| Qdrant `401`/`403` | Fail immediately and mark the generation `failed` | Permanent authorization failure test |
| Transient verification `5xx` | Keep the sealed generation in `verifying`; permit a later finalize retry | Verification resume test |
| Missing Qdrant points | Reject finalization and mark the generation `failed` | Exact generation/scope count tests |
| Final segment is below Qdrant `indexing_threshold` | Accept READY only when collection/optimizer are healthy, exact generation/scope point counts match, and the exact-scan tail is strictly smaller than the threshold | Bounded exact-scan-tail readiness test and 8,103-vector ScriptMem recovery |
| Incomplete or unsealed generation | Reject ANN Search before contacting Qdrant | Dense readiness-barrier test |
| Stale generation result | Reject the result even when scope/profile otherwise match | Qdrant stale-generation test |
| Cross-scope result | Reject the entire result set | Qdrant client and 128-scope worker tests |
| Wrong content hash/session/role/timestamp/point ID | Reject hydration from Qdrant to SQLite raw memory | Dense provenance test |
| Duplicate Add/outbox delivery | Preserve one immutable memory, one outbox row, and one deterministic point | Existing Add and outbox idempotency tests |
| Client disconnect | Abort retries, Agent/model work, Qdrant request, and active SQLite worker task | HTTP disconnect, retry-abort, and worker replacement tests |
| Read-only worker attempts mutation | SQLite rejects the write | Read-only connection test |

The existing evidence-contract tests continue to enforce
`Citations ⊆ Evidence ⊆ Candidates`; none of these failure paths can publish a
partial evidence package as a successful Search response.
