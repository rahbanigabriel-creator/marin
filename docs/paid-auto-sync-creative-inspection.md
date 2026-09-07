# Paid reporting refresh and creative inspection

September 7, 2026. Scope: Marpin only, Google Ads and Meta reporting.

## Changes

- Owners/admins automatically refresh connected paid sources on entry, on a
  reporting-range change, on returning online/visible, and on a bounded timer.
  The server reuses a complete covering snapshot for five minutes. It checks
  freshness under the same account lock used by scheduled jobs and manual sync.
- Concurrent requests defer; failures/partial results back off five minutes;
  rapid range changes have a thirty-second account cooldown. Manual Sync now
  remains available. Revoked accounts and read-only members never auto-sync.
- Hidden/offline pages pause checks. A late response from a previous date range
  cannot replace current data or notices. Automatic refresh does not alter
  provider campaign status, spend, targeting or credentials.
- Meta creative expansion requests 1080px thumbnails with the supported
  thumbnail_width/thumbnail_height parameters. Existing source image URLs still
  take priority and signed CDN URLs are preserved verbatim. There are no extra
  per-ad requests. The provider may still return a lower-resolution source.
- Gallery and featured images no longer upscale tiny previews. The selected
  creative opens first in a body-level native modal with a large preview, full
  copy, creative selection, keyboard navigation and restored opener focus.
- Editing existing campaigns is explicitly a provider-side handoff. Meta links
  select validated account/campaign/ad IDs; Google uses its account selector
  rather than inventing an internal browser account ID. Native existing-campaign
  edits and video playback are not implemented by this change.

## Live diagnosis before the change

All inspected Meta preview images were 64 x 64 pixels while their UI boxes were
240 or 360 pixels wide. The campaign drawer opened, but it prioritized analytics
and put non-clickable small thumbnails below the metrics.

## Launch gates beyond billing

1. Verify customer-ready Google/Meta app access and Google developer-token level;
   prove a new customer's connect, account selection, refresh and revocation flow.
   The owner's current Free workspace has Meta occupying its sole connection
   slot. Google/GA4 additions need a valid entitlement, not an OAuth workaround.
2. Complete an owner-approved real Meta paused-creation acceptance test with the
   correct Page, additional permissions and execution entitlement. The shipped
   direct template is limited; Google creation is assisted. Native live edits,
   activation and autonomous spend-changing optimization remain unimplemented.
3. Verify actual Inngest delivery and recurring execution while the app is closed,
   failure alerting and recovery. The foreground refresh here does not prove the
   six-hour background ingestion job. Current goal agents recommend/review; they
   do not mutate provider campaigns.
4. Validate GA4 and paid conversion/revenue reporting for a new customer. Missing
   attribution must remain unavailable, never fabricated ROAS. AppsFlyer is not
   an implemented connector and must not be advertised as available.
5. Finish a clean-customer release rehearsal, account lifecycle and support
   checks, restore/rollback evidence, incident ownership, and approved public
   privacy/terms. Existing local tests are not evidence that these live gates pass.

These gates do not require reintroducing hidden Organic/SEO or brand-building
surfaces. A limited analytics/copilot beta is a different promise from a fully
autonomous paid-campaign management product.

## Verification

- 83 isolated Postgres integration tests passed with 25 migrations, no skips.
- 779 unit tests passed, no skips; type checking, lint and secret scan passed.
- 29 browser journeys passed: default-open chat across five widths, sync entry
  and cadence, failure backoff, offline/hidden pause, old-range response fencing,
  creative selection, provider links, native modal focus and mobile containment,
  plus the existing Meta paused-creation safety workflows. Providers were mocked
  for those browser tests; desktop/mobile screenshots were inspected.
- The updated Meta creative query returned a complete 14-ad response from the
  owner's existing connection in a read-only live check, without reauthorization.

## Reference

- [Meta's maintained AdCreative API parameter definitions](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adcreative.py)
