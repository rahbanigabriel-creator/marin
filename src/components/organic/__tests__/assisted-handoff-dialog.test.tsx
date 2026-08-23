import assert from "node:assert/strict";
import test from "node:test";
import React, { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  externalCompletionLabel,
  HandoffApprovalRecoveryAction,
} from "../AssistedHandoffDialog";

const noop = () => {};

test("approval recovery is keyed to the stable reason code and exact content item", () => {
  const reviewed: string[] = [];
  let closed = false;
  const action = HandoffApprovalRecoveryAction({
    contentItemId: "content_item_42",
    publicationStatus: "ready",
    reasonCode: "content_version_not_approved",
    onReviewContent: (contentItemId) => reviewed.push(contentItemId),
    onClose: () => {
      closed = true;
    },
  });

  assert.ok(React.isValidElement(action));
  const html = renderToStaticMarkup(action);
  assert.match(html, />Review and approve in Studio</);
  assert.match(html, /aria-describedby="assisted-handoff-blocked-reason"/);
  assert.doesNotMatch(html, /content_item_42/);

  const button = action as ReactElement<{ onClick: () => void }>;
  button.props.onClick();
  assert.deepEqual(reviewed, ["content_item_42"]);
  assert.equal(closed, true);
});

test("approval recovery does not invent navigation without a callback", () => {
  assert.equal(HandoffApprovalRecoveryAction({
    contentItemId: "content_item_42",
    publicationStatus: "ready",
    reasonCode: "content_version_not_approved",
    onClose: noop,
  }), null);

  assert.equal(HandoffApprovalRecoveryAction({
    contentItemId: "content_item_42",
    publicationStatus: "ready",
    reasonCode: "publication_not_ready",
    onReviewContent: noop,
    onClose: noop,
  }), null);

  assert.equal(HandoffApprovalRecoveryAction({
    contentItemId: "content_item_42",
    publicationStatus: "published",
    reasonCode: "content_version_not_approved",
    onReviewContent: noop,
    onClose: noop,
  }), null);
});

test("external completion labels preserve the evidence boundary", () => {
  assert.equal(externalCompletionLabel("user_confirmed_external_handoff"), "User-confirmed external handoff");
  assert.equal(externalCompletionLabel("unverified_external_completion"), "Unverified external completion");
  assert.equal(externalCompletionLabel("not_recorded"), null);
});
