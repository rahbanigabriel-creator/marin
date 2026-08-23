import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const PLACEHOLDER = /^(?:<[^>]+>|replace[-_ ]?me|changeme|example|test|dummy|your[-_ ].*|\$\{.*\})$/i;

const signatures = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["google-oauth-secret", /\bGOCSPX-[A-Za-z0-9_-]{24,}\b/],
  ["google-api-key", /\bAIza[A-Za-z0-9_-]{30,}\b/],
  ["stripe-secret", /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/],
  ["clerk-secret", /\bsk_live_[A-Za-z0-9_$-]{20,}\b/],
  ["anthropic-secret", /\bsk-ant-[A-Za-z0-9_-]{30,}\b/],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ["aws-access-key", /\bAKIA[A-Z0-9]{16}\b/],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
];

const secretEnvNames = [
  "ANTHROPIC_API_KEY",
  "CLERK_SECRET_KEY",
  "DATABASE_URL",
  "DIRECT_URL",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  "LANGFUSE_SECRET_KEY",
  "META_APP_SECRET",
  "RATE_LIMIT_KEY_PEPPER",
  "SENTRY_AUTH_TOKEN",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "TIKTOK_APP_SECRET",
  "TOKEN_ENC_KEY",
  "UPSTASH_REDIS_REST_TOKEN",
  "BLOB_READ_WRITE_TOKEN",
];

function repositoryFiles() {
  return execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  ).split("\0").filter(Boolean);
}

function suspiciousEnvAssignments(content) {
  const findings = [];
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*(?:#.*)?$/);
    if (!match || !secretEnvNames.includes(match[1])) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1).trim();
    }
    if (!value || PLACEHOLDER.test(value)) continue;
    if (/^(?:postgres(?:ql)?|redis):\/\/[^:@/]+:[^@/]+@(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(value)) {
      continue;
    }
    findings.push(`env:${match[1]}`);
  }
  return findings;
}

const findings = [];
for (const file of repositoryFiles()) {
  let size;
  try {
    size = statSync(file).size;
  } catch {
    continue;
  }
  if (size > MAX_FILE_BYTES) continue;

  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (content.includes("\0")) continue;

  for (const [name, signature] of signatures) {
    if (signature.test(content)) findings.push({ file, rule: name });
  }
  for (const rule of suspiciousEnvAssignments(content)) {
    findings.push({ file, rule });
  }
}

if (findings.length) {
  console.error("Potential committed secrets detected:");
  for (const finding of findings.sort((left, right) =>
    left.file.localeCompare(right.file) || left.rule.localeCompare(right.rule))) {
    console.error(`- ${finding.file} (${finding.rule})`);
  }
  process.exitCode = 1;
} else {
  console.log("Secret scan passed.");
}
