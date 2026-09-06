import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWorkspaceLocation,
  workspaceLocationHref,
} from "@/lib/product/navigation";

test("hidden workspaces and old assistant links return to paid campaigns", () => {
  for (const query of ["mode=organic&view=anything", "mode=organic&view=assistant", "mode=organic&view=influencers", "mode=organic&view=seo", "mode=brand", "mode=assistant"]) {
    assert.deepEqual(parseWorkspaceLocation(query), { area: "paid", view: "campaigns" });
  }
});

test("workspace routes restore every launch area", () => {
  assert.deepEqual(parseWorkspaceLocation("mode=paid"), {
    area: "paid",
    view: "campaigns",
  });
  assert.deepEqual(parseWorkspaceLocation("mode=agents"), { area: "agents" });
  assert.deepEqual(parseWorkspaceLocation("mode=analytics"), { area: "analytics" });
});

test("unknown workspace routes fail closed to paid campaigns", () => {
  assert.deepEqual(parseWorkspaceLocation("mode=admin&view=calendar"), {
    area: "paid", view: "campaigns",
  });
  assert.deepEqual(parseWorkspaceLocation(""), { area: "paid", view: "campaigns" });
});

test("workspace hrefs use canonical view names", () => {
  assert.equal(
    workspaceLocationHref({ area: "organic" }),
    "/app?mode=paid&view=campaigns",
  );
  assert.equal(
    workspaceLocationHref({ area: "organic", view: "influencers" }),
    "/app?mode=paid&view=campaigns",
  );
  assert.equal(
    workspaceLocationHref({ area: "paid" }),
    "/app?mode=paid&view=campaigns",
  );
  assert.equal(workspaceLocationHref({ area: "agents" }), "/app?mode=agents");
  assert.equal(workspaceLocationHref({ area: "analytics" }), "/app?mode=analytics");
});
