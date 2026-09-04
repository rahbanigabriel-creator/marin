import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWorkspaceLocation,
  workspaceLocationHref,
} from "@/lib/product/navigation";

test("workspace routes restore every launch area", () => {
  assert.deepEqual(parseWorkspaceLocation("mode=organic&view=anything"), {
    area: "organic",
    view: "calendar",
  });
  assert.deepEqual(parseWorkspaceLocation("mode=organic&view=assistant"), {
    area: "organic",
    view: "assistant",
  });
  assert.deepEqual(parseWorkspaceLocation("mode=organic&view=influencers"), {
    area: "organic",
    view: "influencers",
  });
  assert.deepEqual(parseWorkspaceLocation("mode=organic&view=seo"), {
    area: "organic",
    view: "seo",
  });
  assert.deepEqual(parseWorkspaceLocation("mode=paid"), {
    area: "paid",
    view: "campaigns",
  });
  assert.deepEqual(parseWorkspaceLocation("mode=brand"), { area: "assistant" });
  assert.deepEqual(parseWorkspaceLocation("mode=agents"), { area: "agents" });
  assert.deepEqual(parseWorkspaceLocation("mode=analytics"), { area: "analytics" });
  assert.deepEqual(parseWorkspaceLocation("mode=assistant"), { area: "assistant" });
});

test("unknown workspace routes fail closed to the assistant", () => {
  assert.deepEqual(parseWorkspaceLocation("mode=admin&view=calendar"), {
    area: "assistant",
  });
  assert.deepEqual(parseWorkspaceLocation(""), { area: "assistant" });
});

test("workspace hrefs use canonical view names", () => {
  assert.equal(
    workspaceLocationHref({ area: "organic" }),
    "/app?mode=organic&view=calendar",
  );
  assert.equal(
    workspaceLocationHref({ area: "organic", view: "influencers" }),
    "/app?mode=organic&view=influencers",
  );
  assert.equal(
    workspaceLocationHref({ area: "paid" }),
    "/app?mode=paid&view=campaigns",
  );
  assert.equal(workspaceLocationHref({ area: "agents" }), "/app?mode=agents");
  assert.equal(workspaceLocationHref({ area: "analytics" }), "/app?mode=analytics");
});
