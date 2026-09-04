import assert from "node:assert/strict";
import test from "node:test";

import { leadHeadline } from "@/lib/agent/headline";

test("card-backed headlines preserve decimal metrics", () => {
  const text =
    "Fitura spent €13.65 over 90 days. The account-level CTR was 17.3%. Every campaign is paused. This final sentence should be trimmed.";
  const headline = leadHeadline(text, 100);

  assert.equal(
    headline,
    "Fitura spent €13.65 over 90 days. The account-level CTR was 17.3%. Every campaign is paused.",
  );
  assert.doesNotMatch(headline, /^65\b/);
  assert.doesNotMatch(headline, /(?:^|\s)3% CTR/);
});

test("headline parsing does not split a domain name", () => {
  const text = "Review www.marpin.ai today. Then prioritize the paid account. This sentence is intentionally extra.";
  assert.equal(
    leadHeadline(text, 65),
    "Review www.marpin.ai today. Then prioritize the paid account.",
  );
});
