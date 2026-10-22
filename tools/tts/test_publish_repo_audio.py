"""Local Git end-to-end test: MP3s belong to an orphan media branch."""

import subprocess
import tempfile
import unittest
from pathlib import Path

from publish_repo_audio import publish, run_git


def git(*args: str, cwd: Path) -> str:
    proc = subprocess.run(["git", *args], cwd=cwd, check=True,
                          text=True, capture_output=True, encoding="utf-8")
    return proc.stdout.strip()


class AudioRepoTests(unittest.TestCase):
    def test_publish_skip_other_slug_replace_and_release_fallback(self):
        with tempfile.TemporaryDirectory() as dirname:
            root = Path(dirname)
            remote = root / "remote.git"
            work = root / "work"
            git("init", "--bare", "--initial-branch=main", str(remote), cwd=root)
            git("clone", str(remote), str(work), cwd=root)
            git("config", "user.name", "Testing", cwd=work)
            git("config", "user.email", "test@example.com", cwd=work)
            (work / "README.md").write_text("Site", encoding="utf-8")
            git("add", ".", cwd=work)
            git("commit", "-m", "Website", cwd=work)
            git("push", "origin", "main", cwd=work)

            # Real Actions produces audio inside an ignored .audio/ directory.
            generated = work / ".audio"
            generated.mkdir()
            a = generated / "bulkhead.mp3"
            a.write_bytes(b"ID3" + b"first recording")
            self.assertEqual(publish("bulkhead", a, work), "published")
            self.assertIn("audio/bulkhead.mp3", git("--git-dir", str(remote),
                          "ls-tree", "-r", "--name-only", "audio", cwd=root))
            self.assertNotIn("README.md", git("--git-dir", str(remote),
                             "ls-tree", "-r", "--name-only", "audio", cwd=root))
            self.assertEqual(publish("bulkhead", a, work), "skipped")

            b = generated / "hedged-requests.mp3"
            b.write_bytes(b"ID3" + b"second recording")
            self.assertEqual(publish("hedged-requests", b, work), "published")
            files = git("--git-dir", str(remote), "ls-tree", "-r",
                        "--name-only", "audio", cwd=root)
            self.assertEqual(set(files.splitlines()),
                             {"audio/bulkhead.mp3", "audio/hedged-requests.mp3"})

            a.write_bytes(b"ID3" + b"new voice")
            self.assertEqual(publish("bulkhead", a, work), "skipped")
            self.assertEqual(publish("bulkhead", a, work, replace=True), "published")
            file_contents = subprocess.run(
                ["git", "--git-dir", str(remote), "show",
                 "audio:audio/bulkhead.mp3"],
                check=True, capture_output=True
            ).stdout
            self.assertEqual(file_contents, b"ID3new voice")
            self.assertEqual(publish("bulkhead", a, work, replace=True), "skipped")
            self.assertEqual(publish("bulkhead", a, work, max_bytes=1), "fallback")
            with self.assertRaises(ValueError):
                publish("../secret", a, work)
            with self.assertRaises(ValueError):
                publish("missing", root / "missing.mp3", work)

            main_files = git("--git-dir", str(remote), "ls-tree", "-r",
                             "--name-only", "main", cwd=root)
            self.assertEqual(main_files, "README.md")


if __name__ == "__main__":
    unittest.main()
