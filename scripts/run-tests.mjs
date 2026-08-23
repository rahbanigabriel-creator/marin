import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const mode = process.argv[2];
if (mode !== "unit" && mode !== "integration") {
  console.error("Usage: node scripts/run-tests.mjs <unit|integration>");
  process.exit(2);
}

async function testFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? testFiles(fullPath) : [fullPath];
  }));
  return nested.flat();
}

const files = (await testFiles(path.join(process.cwd(), "src")))
  .filter((file) => /\.test\.(?:ts|tsx)$/.test(file))
  .filter((file) => mode === "integration"
    ? file.endsWith(".integration.test.ts") || file.endsWith(".integration.test.tsx")
    : !file.includes(".integration.test."))
  .map((file) => path.relative(process.cwd(), file))
  .sort();

if (!files.length) {
  console.error(`No ${mode} tests were found.`);
  process.exit(2);
}

const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const argumentsList = [
  tsxCli,
  "--tsconfig",
  "tsconfig.test.json",
  "--test",
  ...(mode === "integration" ? ["--test-concurrency=1"] : []),
  ...files,
];

const childEnvironment = { ...process.env };
if (mode === "integration") {
  // `tsx --test` creates Node test workers. NODE_OPTIONS is set by the official
  // runner so the React server export condition reaches those workers too.
  const options = childEnvironment.NODE_OPTIONS?.trim();
  const condition = "--conditions=react-server";
  childEnvironment.NODE_OPTIONS = options?.includes(condition)
    ? options
    : [options, condition].filter(Boolean).join(" ");
}

const child = spawn(process.execPath, argumentsList, {
  cwd: process.cwd(),
  env: childEnvironment,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(error instanceof Error ? error.message : "Test runner failed to start.");
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
