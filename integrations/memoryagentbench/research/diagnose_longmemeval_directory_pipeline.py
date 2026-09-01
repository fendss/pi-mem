#!/usr/bin/env python3
"""Run the frozen pipeline diagnostic with two-layer directory candidates.

The legacy diagnostic treats only ``details.candidates`` as retrieved.  In the
two-layer experiment, ``details.directoryCandidates`` are also model-visible,
have stable C refs, and can be read directly.  This research-only adapter adds
that field to candidate coverage without changing the frozen benchmark code.
"""

from __future__ import annotations

from typing import Any

import diagnose_longmemeval_pipeline as frozen


_FROZEN_SCOPE_FROM_AUDIT = frozen._scope_from_audit  # noqa: SLF001


def _candidate_ids(audit: dict[str, Any]) -> set[str]:
    result: set[str] = set()
    for trace in (audit.get("retrieval") or {}).get("trace") or []:
        details = trace.get("details") or {}
        for field in ("candidates", "directoryCandidates"):
            for candidate in details.get(field) or []:
                memory_id = candidate.get("memoryId")
                if isinstance(memory_id, str):
                    result.add(memory_id)
    return result


def _scope_from_audit(audit: dict[str, Any]) -> str | None:
    scope = _FROZEN_SCOPE_FROM_AUDIT(audit)
    if scope is not None:
        return scope
    for trace in (audit.get("retrieval") or {}).get("trace") or []:
        details = trace.get("details") or {}
        for candidate in details.get("directoryCandidates") or []:
            scope_id = candidate.get("scopeId")
            if isinstance(scope_id, str):
                return scope_id
    return None


frozen._candidate_ids = _candidate_ids  # type: ignore[attr-defined]  # noqa: SLF001
frozen._scope_from_audit = _scope_from_audit  # type: ignore[attr-defined]  # noqa: SLF001


if __name__ == "__main__":
    frozen.main()
