import assert from "node:assert/strict";
import test from "node:test";

import { oauthSelectionPageHeaders } from "./_lib/selection-headers";
import { validateSameOriginMutation } from "@/lib/security/request-origin";

test("OAuth account picker preserves origin-only provenance for its POST", () => {
  const headers = oauthSelectionPageHeaders();

  assert.equal(headers["Referrer-Policy"], "origin");
  assert.match(headers["Content-Security-Policy"], /form-action 'self'/);

  assert.deepEqual(
    validateSameOriginMutation({
      headers: { referer: "https://www.marpin.ai/" },
      appUrl: "https://www.marpin.ai",
      isProduction: true,
    }),
    { allowed: true, provenance: "referer" },
  );
});
