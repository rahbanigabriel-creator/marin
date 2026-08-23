import { spawn } from "node:child_process";
import path from "node:path";

function abort(message) {
  console.error(`Refusing disposable migration: ${message}`);
  process.exit(1);
}

if (process.env.MARPIN_INTEGRATION_DATABASE !== "1") {
  abort("MARPIN_INTEGRATION_DATABASE must be exactly 1");
}

const databaseUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;
const allowedUrl = process.env.POSTGRES_TEST_URL ?? process.env.TEST_DATABASE_URL;

if (!databaseUrl || !directUrl || !allowedUrl) {
  abort("DATABASE_URL, DIRECT_URL, and POSTGRES_TEST_URL or TEST_DATABASE_URL are required");
}
if (databaseUrl !== allowedUrl || directUrl !== allowedUrl) {
  abort("DATABASE_URL and DIRECT_URL must both equal the explicit test database URL");
}

let parsed;
try {
  parsed = new URL(allowedUrl);
} catch {
  abort("the explicit test database URL is invalid");
}

const databaseName = parsed.pathname.slice(1);
const localHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
const disposableName = /(?:_test|_ci)$/.test(databaseName);
if (!localHost || !disposableName) {
  abort("the target must be a local database whose name ends in _test or _ci");
}

const prismaCli = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");
const child = spawn(process.execPath, [prismaCli, "migrate", "deploy"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(error instanceof Error ? error.message : "Prisma failed to start");
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
