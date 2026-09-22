import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGenerationSystem } from "./lib/generation-system.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const system = await loadGenerationSystem(root);
  const modules = [system.authoring, ...system.tasks.values(), ...system.frameworks.values()];
  const totalBytes = modules.reduce((sum, module) => sum + module.bytes, 0);
  console.log(
    `PASS: generation registry v${system.registry.version} contains ${system.tasks.size} task(s), ` +
    `${system.frameworks.size} framework(s) and ${totalBytes} bytes of allowlisted modules.`
  );
} catch (error) {
  console.error(`Generation registry validation failed: ${error.message}`);
  process.exit(1);
}
