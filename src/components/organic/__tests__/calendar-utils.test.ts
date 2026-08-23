import assert from "node:assert/strict";
import test from "node:test";

import {
  addCalendarDays,
  monthGridStart,
  normalizeCalendarResponse,
  startOfCalendarWeek,
  startOfCalendarMonth,
  wallClockFromIso,
  zonedDateTimeToIso,
} from "../calendar-utils";

test("calendar arithmetic uses Monday weeks and stable UTC date keys", () => {
  assert.equal(startOfCalendarWeek("2026-07-20"), "2026-07-20");
  assert.equal(startOfCalendarWeek("2026-07-26"), "2026-07-20");
  assert.equal(addCalendarDays("2026-02-28", 1), "2026-03-01");
  assert.equal(monthGridStart("2026-07-20"), "2026-06-29");
  assert.equal(startOfCalendarMonth("2026-07-20"), "2026-07-01");
});

test("calendar instants retain the explicit Europe/Madrid seasonal offset", () => {
  assert.equal(zonedDateTimeToIso("2026-07-20", "09:15", "Europe/Madrid"), "2026-07-20T09:15:00+02:00");
  assert.equal(zonedDateTimeToIso("2026-01-20", "09:15", "Europe/Madrid"), "2026-01-20T09:15:00+01:00");
  assert.deepEqual(wallClockFromIso("2026-07-20T09:15:00+02:00", "Europe/Madrid"), {
    date: "2026-07-20",
    time: "09:15",
  });
});

test("nonexistent daylight-saving wall times fail instead of shifting silently", () => {
  assert.throws(
    () => zonedDateTimeToIso("2026-03-29", "02:30", "Europe/Madrid"),
    /does not exist/,
  );
});

test("calendar responses normalize nested content and honest publication status", () => {
  const posts = normalizeCalendarResponse({
    items: [
      {
        id: "item_1",
        title: "Founder lesson",
        coreCopy: "A useful lesson.",
        status: "review",
        version: 4,
        publications: [
          {
            id: "pub_1",
            contentItemId: "item_1",
            platform: "linkedin" as "instagram",
            format: "post",
            status: "ready",
            title: null,
            body: "Fallback copy",
            scheduledAt: "2026-07-20T09:15:00+02:00",
          },
          {
            id: "pub_2",
            contentItemId: "item_1",
            platform: "instagram",
            format: "reel",
            status: "ready",
            title: null,
            body: "Fallback copy",
            scheduledAt: "2026-07-21T09:15:00+02:00",
          },
        ],
      },
    ],
  });

  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0], {
    publicationId: "pub_2",
    contentItemId: "item_1",
    title: "Founder lesson",
    copy: "Fallback copy",
    platform: "instagram",
    format: "reel",
    status: "ready",
    scheduledAt: "2026-07-21T09:15:00+02:00",
    expectedVersion: 4,
    planId: null,
  });
});

test("calendar responses join versions without flattening channel-specific copy", () => {
  const posts = normalizeCalendarResponse({
    calendar: {
      contentItems: [
        {
          id: "item_direct",
          title: "Versioned idea",
          coreCopy: "The canonical copy.",
          status: "draft",
          version: 7,
        },
      ],
      publications: [
        {
          id: "pub_direct",
          contentItemId: "item_direct",
          platform: "youtube",
          format: "short",
          status: "draft",
          title: "Stale variant title",
          body: "Stale variant copy",
          scheduledAt: "2026-07-23T10:00:00Z",
        },
      ],
    },
  });

  assert.equal(posts[0]?.title, "Stale variant title");
  assert.equal(posts[0]?.copy, "Stale variant copy");
  assert.equal(posts[0]?.expectedVersion, 7);
});

test("calendar responses preserve terminal publication history", () => {
  const posts = normalizeCalendarResponse({
    calendar: {
      contentItems: [
        {
          id: "item_published",
          title: "Published idea",
          coreCopy: "Master copy",
          status: "approved",
          version: 9,
        },
      ],
      publications: [
        {
          id: "pub_published",
          contentItemId: "item_published",
          platform: "pinterest",
          format: "pin",
          status: "published",
          title: "Published pin",
          body: "Exact public copy",
          scheduledAt: "2026-07-23T10:00:00Z",
        },
      ],
    },
  });

  assert.equal(posts[0]?.status, "published");
  assert.equal(posts[0]?.title, "Published pin");
  assert.equal(posts[0]?.copy, "Exact public copy");
});
