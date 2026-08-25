from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


INTEGRATION_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(INTEGRATION_ROOT))

from upstream.contracts import UpstreamContractError  # noqa: E402
from upstream.prepare import pimem_source_identity  # noqa: E402


class UpstreamPrepareTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / "pimem"
        self.root.mkdir()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        subprocess.run(
            ["git", "-C", str(self.root), "config", "user.email", "fixture@example.test"],
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(self.root), "config", "user.name", "Fixture"],
            check=True,
        )
        (self.root / "source.ts").write_text("export {};\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(self.root), "add", "source.ts"], check=True)
        subprocess.run(
            ["git", "-C", str(self.root), "commit", "-q", "-m", "fixture"],
            check=True,
        )
        subprocess.run(
            [
                "git", "-C", str(self.root), "remote", "add", "origin",
                "https://example.test/pimem.git",
            ],
            check=True,
        )

    def test_clean_full_git_identity_is_locked(self):
        identity = pimem_source_identity(self.root)
        self.assertEqual(identity["repository"], "https://example.test/pimem.git")
        self.assertRegex(str(identity["revision"]), r"^[0-9a-f]{40}$")
        self.assertIs(identity["clean_worktree"], True)

    def test_dirty_or_untracked_source_is_rejected(self):
        (self.root / "untracked.ts").write_text("export {};\n", encoding="utf-8")
        with self.assertRaisesRegex(UpstreamContractError, "fully clean"):
            pimem_source_identity(self.root)

    def test_credential_bearing_origin_is_rejected(self):
        subprocess.run(
            [
                "git", "-C", str(self.root), "remote", "set-url", "origin",
                "https://token@example.test/pimem.git",
            ],
            check=True,
        )
        with self.assertRaisesRegex(UpstreamContractError, "credentials"):
            pimem_source_identity(self.root)


if __name__ == "__main__":
    unittest.main()
