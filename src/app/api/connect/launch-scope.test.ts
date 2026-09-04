import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROUTES = [
  "src/app/api/connect/[platform]/route.ts",
  "src/app/api/connect/[platform]/callback/route.ts",
  "src/app/api/connect/[platform]/select/route.ts",
] as const;

test("every OAuth entry point applies the launch allowlist before resolving a connector", () => {
  for (const route of ROUTES) {
    const source = readFileSync(path.join(process.cwd(), route), "utf8");
    const launchGate = source.indexOf("if (!isLaunchConnectorPlatform(platform))");
    const configLookup = source.indexOf("const config = getConnectorConfig(platform)");
    assert.notEqual(launchGate, -1, `${route} is missing the launch allowlist`);
    assert.notEqual(configLookup, -1, `${route} is missing connector resolution`);
    assert.ok(launchGate < configLookup, `${route} resolves dormant connectors before the launch gate`);
    assert.match(source.slice(launchGate, configLookup), /platform_not_in_launch_scope/);
  }
});
