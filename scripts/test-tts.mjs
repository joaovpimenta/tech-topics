import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const candidates = process.env.TECH_TOPICS_PYTHON ? [process.env.TECH_TOPICS_PYTHON] : [...(existsSync(local) ? [local] : []), "python3", "python"];
const python = candidates.find(command => {
  const version = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 10000, windowsHide: true });
  const match = `${version.stdout || ""}${version.stderr || ""}`.match(/Python 3\.(\d+)/);
  return version.status === 0 && match && Number(match[1]) >= 11;
});
if (!python) {
  if (process.env.TECH_TOPICS_REQUIRE_TTS_TESTS === "1" || process.env.TECH_TOPICS_PYTHON) {
    console.error("TTS tests require Python >=3.11; set TECH_TOPICS_PYTHON to an available interpreter");
    process.exitCode = 1;
  } else console.log("SKIP: optional local TTS tests (Python >=3.11 unavailable); CI requires these tests");
} else {
  const result = spawnSync(python, ["-m", "unittest", "discover", "-s", "tools/tts", "-p", "test_*.py"], { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
