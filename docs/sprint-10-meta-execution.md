# Sprint 10: Meta paused campaign creation

## Scope and acceptance

The launch paid platforms remain Google Ads and Meta Ads. This slice adds an
explicit Meta paused-creation path without changing existing read-only OAuth or
the assisted Google workflow. It does not implement direct activation or budget
updates for existing campaigns.

The live acceptance gate is a separately reviewed Fitura draft whose campaign,
ad set and every ad are returned by Meta with configured status PAUSED. Local
tests or an OAuth success do not satisfy this gate.

## Implemented

- Visual manual editor, asset previews, ad selection and mobile/desktop previews.
- Explicit delivery settings stored in the exact immutable draft snapshot.
- Optional Meta OAuth step-up: ads_management, pages_show_list and
  pages_read_engagement. Default reporting scopes are unchanged.
- Live permission, ad-account, Page task, currency and timezone checks.
- Rechecked access at approval and execution, exact approval consumption under
  a database lock, durable checkpoints before and after every provider POST.
- No automatic retry of provider writes. Incomplete outcomes retain object IDs
  and freeze the draft for read-only reconciliation.
- Verified provider confirmation is distinguished from a manual user assertion.
- Current paid execution entitlement is checked before preflight, at approval,
  under the execution claim, and before each new provider POST. Read-only
  recovery remains available after a downgrade.
- Upload reservations cannot be approved. Credential rotation or revocation
  stops further writes, while already acknowledged IDs remain in the audit.
- A proven failure before any POST consumes the old approval and returns the
  draft to editing for a fresh review. Uncertain outcomes never use this path.
- Authenticated user/workspace throttles bound repeated provider preparation.
- Preparation has one 45-second deadline, cancellable media reads and at most
  eight in-flight preparations per process. Only requests for the same approval
  can share a preparation; finished image buffers are not cached.

## Supported Direct Template

Meta traffic to a website or App Store link, Facebook Feed only, one audience,
one to three JPG/PNG image ads (maximum 8 MB each), daily or lifetime budget in
EUR, USD, GBP, CAD or AUD. The complete budget goes to one ad set, never to each
ad independently. Country selection is restricted to the enumerated supported
ISO country codes. Audience language is explicitly All languages, with no
interest filters and ages 18-65. The user confirms no special ad category and
provides the ad beneficiary and payer.

Unsupported targeting is rejected, never silently discarded. Lead forms,
app-install tracking, video delivery, Instagram delivery and multiple audiences
remain assisted preparation. Previewing an Instagram placement is not proof of
Instagram delivery support.

## Safety and Recovery

Approval binds account, Page, asset IDs, copy, destination, targeting, budget,
schedule and beneficiary/payer to a version and hash. Private uploads are
immutable objects; their tenant, bytes and MIME are rechecked before creation.
The approval is consumed before any provider POST; a second browser request
cannot create a second campaign.

Meta creation uses PAUSED for campaign, ad set and ads. The adapter cannot POST
to existing object IDs and has no activation or deletion operation. Verification
checks all expected IDs, account/parent/creative relationships and exact PAUSED
statuses. It does not yet compare every normalized remote configuration field.
That limitation must be resolved before any future direct activation adapter.

If creation is interrupted, use Check created objects. It only reads IDs already
recorded by this attempt. An unknown result from a timed-out POST is not retried
or rediscovered by campaign name. Inspect Meta manually before resolving partial
objects; do not create another copy while the result is uncertain.

An ID returned before a failed database checkpoint is retained by the adapter
and written to the failure audit when persistence recovers. A complete database
outage can still leave only the earlier durable submission intent; that case
requires inspection in Meta and must never trigger a blind retry.

## Rollout Checklist

- [x] Apply all migrations to disposable Postgres and exercise concurrency.
- [x] Unit tests with injected Meta responses and interrupted checkpoints.
- [x] Independent security review: all seven reported findings resolved.
- [x] Integrated browser tests and desktop/mobile screenshots.
- [x] Apply additive migration 20260905000000_meta_paused_execution to production.
- [x] Apply earlier pending check expansion 20260822002000_add_paid_external_activation_outcomes.
- [ ] Deploy and smoke-test the production editor and read-only access check.
- [ ] Owner approves additional Meta permissions and selects the correct Page.
- [ ] Owner approves one exact test snapshot for real paused creation.
- [ ] Workspace has a valid execution entitlement; no free-plan bypass for testing.
- [ ] Meta returns a complete verified paused campaign; no spend/activation.

## External Gates

Reporting-only Meta tokens do not authorize creation. Developer-app permissions,
app access level, the user's ad-account task and Page advertising task still
need live confirmation. Any missing permission remains visible instead of
pretending a campaign was created. Google write permissions/developer-token
review, recurring Inngest worker verification and Stripe production validation
are separate release gates and are not completed by this sprint.

## Verification Record

- 684 unit tests passed, including private-media deadline and provider failures.
- 69 isolated database/integration tests passed across all 24 migrations.
- Typecheck, lint and secret scan passed before rollout.
- 16 browser journeys passed: new Meta flow, legacy paid drafts, paid reporting,
  read-only members, image rendering and 1280px/390px layouts. External providers
  were mocked; this is not a real-account creation result.

## Primary References

- [Meta's maintained Marketing API SDK account creation fields](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py)
- [Meta's maintained ad set fields](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adset.py)
- [Meta's official onboarding API examples](https://www.postman.com/meta/facebook-marketing-api/documentation/9jo4f5y/mapi-onboarding)
