import assert from "node:assert/strict";
import test from "node:test";
import { metaPausedFixture } from "../__fixtures__/meta-paused";
import { assertMetaPausedSnapshot, metaPausedIssues } from "../meta-paused-contract";
import { parsePaidCampaignSnapshotV1 } from "../validation";
import { hashPaidCampaignSnapshotV1 } from "../hash";
import { assertMetaPublishingAccess } from "../meta-paused-execution";
import type { MetaPublishingAccess } from "@/lib/connectors/meta-publishing-access";
import { buildPaidCampaignSnapshot, formFromPaidDraft, validatePaidDraftForm } from "@/components/paid/paid-draft-form";

test("Meta delivery is optional for legacy snapshots, exact and immutable for direct drafts", () => {
  const snapshot = metaPausedFixture();
  const { metaDelivery: _delivery, ...legacy } = snapshot;
  assert.equal(_delivery.pageId, "987654321");
  assert.equal(Object.hasOwn(parsePaidCampaignSnapshotV1(legacy), "metaDelivery"), false);
  const parsed = parsePaidCampaignSnapshotV1(snapshot);
  assertMetaPausedSnapshot(parsed);
  assert.equal(Object.isFrozen(parsed.metaDelivery), true);
  assert.equal(hashPaidCampaignSnapshotV1(parsed), hashPaidCampaignSnapshotV1(parsePaidCampaignSnapshotV1(parsed)));
  for (const change of [{ pageId: "987654322" }, { payer: "Another payer" }, { beneficiary: "Another beneficiary" }]) {
    assert.notEqual(hashPaidCampaignSnapshotV1(parsed), hashPaidCampaignSnapshotV1({ ...snapshot, metaDelivery: { ...snapshot.metaDelivery, ...change } }));
  }
  assert.throws(() => parsePaidCampaignSnapshotV1({ ...snapshot, metaDelivery: { ...snapshot.metaDelivery, status: "ACTIVE" } }));
  assert.throws(() => parsePaidCampaignSnapshotV1({ ...snapshot, metaDelivery: { ...snapshot.metaDelivery, placement: "automatic" } }));
});

test("direct targeting never silently drops interests, language or ambiguous countries", () => {
  const snapshot = metaPausedFixture();
  assert.deepEqual(metaPausedIssues(snapshot), []);
  for (const targeting of [{ locations: ["Spain"] }, { languages: ["Spanish"] }, { interests: ["Fitness"] }, { ageMin: 17 }]) {
    const changed = { ...snapshot, adGroups: [{ ...snapshot.adGroups[0], targeting: { ...snapshot.adGroups[0].targeting, ...targeting } }] };
    assert.equal(metaPausedIssues(changed).length, 1);
    assert.throws(() => assertMetaPausedSnapshot(changed));
  }
  assert.throws(() => assertMetaPausedSnapshot({ ...snapshot, adGroups: [...snapshot.adGroups, ...snapshot.adGroups] }));
  assert.throws(() => assertMetaPausedSnapshot({ ...snapshot, budget: { ...snapshot.budget, currency: "JPY" } }));
});

test("publishing access requires live scope, Page, account, currency and timezone matches", () => {
  const snapshot = metaPausedFixture();
  const access: MetaPublishingAccess = { accountId: snapshot.connection.accountId, currency: "EUR", timezone: "UTC", canAdvertise: true, permissions: { adsManagement: true, pagesShowList: true, pagesReadEngagement: true }, pages: [{ id: snapshot.metaDelivery.pageId, name: "Test Page", canAdvertise: true }], pagesComplete: true };
  assert.doesNotThrow(() => assertMetaPublishingAccess(snapshot, access));
  for (const change of [{ accountId: "999" }, { currency: "USD" }, { timezone: "Europe/Madrid" }, { pages: [] }, { canAdvertise: false }, { permissions: { ...access.permissions, adsManagement: false } }]) {
    assert.throws(() => assertMetaPublishingAccess(snapshot, { ...access, ...change }));
  }
});

test("manual editor preserves delivery approval fields and requires explicit category confirmation", () => {
  const snapshot = metaPausedFixture();
  const form = formFromPaidDraft(snapshot);
  assert.equal(form.metaCategoryConfirmed, true);
  assert.deepEqual(buildPaidCampaignSnapshot(form).platform, "meta_ads");
  const rebuilt = buildPaidCampaignSnapshot(form);
  assert.equal(rebuilt.platform === "meta_ads" && rebuilt.metaDelivery?.pageId, snapshot.metaDelivery.pageId);
  assert.equal(validatePaidDraftForm({ ...form, metaCategoryConfirmed: false }).issues[0].path, "metaDelivery.specialAdCategory");
});
