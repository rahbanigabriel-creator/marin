import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const report = resolve(root, process.env.JEST_JUNIT_OUTPUT_FILE || process.env.MOCHA_FILE || "test-results/junit.xml");
// Never let an earlier successful report stand in for this run.
rmSync(report, { force: true });
mkdirSync(dirname(report), { recursive: true });

function discover(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return discover(path);
    return entry.isFile() && /\.test\.(?:ts|tsx|mts|js|mjs)$/.test(entry.name) ? [path] : [];
  });
}

const tests = discover(join(root, "src")).sort();
if (!tests.length) throw new Error("No test files found under src");
const result = spawnSync(process.execPath, [
  "--import", "tsx", "--test", "--test-concurrency=1",
  "--test-reporter=spec", "--test-reporter-destination=stdout",
  "--test-reporter=junit", `--test-reporter-destination=${report}`,
  ...tests,
], { cwd: root, stdio: "inherit", env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
