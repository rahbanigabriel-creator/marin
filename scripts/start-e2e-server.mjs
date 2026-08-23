import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const distDir = resolve(root, ".next-e2e");
const stampPath = resolve(distDir, ".marpin-source-hash");

function hashPath(hash, path, label) {
  if (!existsSync(path)) return;
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path).sort()) {
      hashPath(hash, resolve(path, entry), `${label}/${entry}`);
    }
    return;
  }
  hash.update(label);
  hash.update(readFileSync(path));
}

const sourceHash = createHash("sha256");
for (const entry of [
  "src",
  "prisma",
  "public",
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "postcss.config.mjs",
  "tailwind.config.ts",
  "tsconfig.json",
]) {
  hashPath(sourceHash, resolve(root, entry), entry);
}
const sourceDigest = sourceHash.digest("hex");
const reusableBuild =
  existsSync(resolve(distDir, "BUILD_ID")) &&
  existsSync(stampPath) &&
  readFileSync(stampPath, "utf8").trim() === sourceDigest;

if (!reusableBuild) rmSync(distDir, { recursive: true, force: true });

// Start from an explicit environment allowlist. Next loads .env* files itself,
// so predeclare every key found in those files as empty before it boots. This
// guarantees browser tests cannot inherit production databases, OAuth clients,
// billing keys, queues, email credentials, or analytics tokens now or later.
const blockedEnv = {};
for (const filename of readdirSync(root).filter((name) => /^\.env(?:\.|$)/.test(name))) {
  const source = readFileSync(resolve(root, filename), "utf8");
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match?.[1]) blockedEnv[match[1]] = "";
  }
}

const allowedEnv = {
  ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
  ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
  ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
  ...(process.env.CI ? { CI: process.env.CI } : {}),
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_DIST_DIR: ".next-e2e",
  APP_URL: "http://127.0.0.1:3100",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100",
  MARPIN_E2E: "1",
  TZ: "UTC",
};

for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, blockedEnv, allowedEnv);

const nextBin = resolve(root, "node_modules/next/dist/bin/next");
if (!reusableBuild) {
  const build = spawnSync(process.execPath, [nextBin, "build"], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
  writeFileSync(stampPath, `${sourceDigest}\n`, "utf8");
}

// Execute the production server in this process. Playwright can terminate the
// actual server directly; there is no long-lived child process to orphan.
process.argv = [
  process.execPath,
  nextBin,
  "start",
  "--hostname",
  "127.0.0.1",
  "--port",
  "3100",
];
await import(pathToFileURL(nextBin).href);
