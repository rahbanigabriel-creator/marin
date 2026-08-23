# Marpin Sprint 0 Product Contract

Status: locked for implementation  
Owner: Product and Engineering  
Product: Marpin, the distribution operating system for a technical solo founder

This document is the source of truth for launch scope. Where an older plan mentions
additional platforms, fake forecasts, or broader execution claims, this contract wins.
Dormant adapters may remain in the codebase, but they are not part of the product.

## 1. Product Promise

Marpin turns a company URL into an operating distribution system. A solo founder can:

1. Enter a URL and receive an evidence-backed website and marketing audit.
2. Review and correct the brand, audience, offer, voice, competitors, and goals Marpin learned.
3. Build a weekly or monthly organic and SEO plan on a real visual calendar.
4. Create every post manually, with AI assistance, or by delegating a bounded task to an agent.
5. Upload existing assets or generate new creative through a provider-neutral media workflow.
6. Schedule and publish where an approved API is available, with honest assisted handoff elsewhere.
7. Audit and improve SEO using website data, GA4, and Google Search Console evidence.
8. Read, prepare, review, and manage paid campaigns across Google Ads, Meta Ads, and TikTok Ads.
9. Move from insight to a persisted draft, approval, execution attempt, and measured result without
   losing context between chat and manual product surfaces.

Marpin is a SaaS workspace with an AI operating layer. The chat is not the product by itself.
Every important workflow must remain usable through manual controls.

## 2. Launch Non-Goals

- No paid networks beyond Google Ads, Meta Ads, and TikTok Ads.
- No organic destinations beyond YouTube, Instagram, Facebook, TikTok, Snapchat, Reddit, and
  Pinterest.
- No claim that Marpin published, launched, scheduled, fixed, or changed anything unless a real
  provider response is persisted.
- No autonomous public posting or ad spend. These always require explicit human approval.
- No one-click paid launch. Campaigns are created as paused drafts and require a second approval
  before becoming live.
- No fabricated forecasts, sample metrics presented as live data, or missing values rendered as zero.
- No promise of deterministic attribution, guaranteed growth, or guaranteed SEO ranking.
- No native mobile app, enterprise procurement suite, or multi-level approval chains at initial launch.
- No hard dependency on SEMrush, Ahrefs, an influencer marketplace, or a specific media model.
- No exposing raw model reasoning. The UI may show concise, truthful activity and tool status only.

## 3. Launch Platform Catalog

The product catalog is separate from the OAuth implementation registry. User-facing navigation,
connections, agent tools, action labels, dashboards, and filters must derive from this catalog.

### Organic and SEO destinations

| Platform | Launch use |
| --- | --- |
| YouTube | Videos, Shorts, titles, descriptions, thumbnails, and publishing plans |
| Instagram | Feed posts, Reels, Stories, and carousel variants |
| Facebook | Page posts, video, and community content |
| TikTok | Organic videos, captions, hooks, and weekly plans |
| Snapchat | Spotlight and Story content plans |
| Reddit | Community-aware posts, replies, and discussion plans |
| Pinterest | Pins, boards, descriptions, links, and creative variants |

SEO is a first-class workflow within Organic and SEO, not a publishing destination.

### Paid destinations

| Platform | Launch use |
| --- | --- |
| Google Ads | Reporting, reviewable campaign drafts, approved changes, and eventual writeback |
| Meta Ads | Facebook and Instagram ad reporting, drafts, approved changes, and writeback |
| TikTok Ads | Reporting, campaign drafts, approved changes, and writeback |

### Evidence sources

| Source | Purpose |
| --- | --- |
| Google Analytics 4 | Traffic, engagement, conversion, and landing-page evidence |
| Google Search Console | Queries, pages, indexing, ranking, and search-performance evidence |

Evidence sources never appear as content destinations. Organic TikTok and TikTok Ads, and organic
Facebook/Instagram and Meta Ads, are distinct product identities even when one authorization exposes
multiple accounts.

## 4. Information Architecture

The workspace has two operating modes that share one brand brain and one history:

- Organic and SEO: content, calendar, publishing, SEO, and influencer workflows.
- Paid Campaigns: Google Ads, Meta Ads, and TikTok Ads reporting and management.

Primary navigation:

1. Assistant
2. Organic and SEO
3. Content Calendar
4. Content Studio
5. SEO
6. Influencers
7. Paid Campaigns
8. Analytics

Secondary navigation:

1. Connections
2. Settings
3. Billing

Rules:

- The left sidebar is collapsible and preserves conversation history.
- Connection setup lives under Connections, not as permanent sidebar clutter.
- Model/effort selection lives beside the composer send control.
- Organic and Paid context may change the active assistant instructions, but never create disconnected
  brand memory or duplicate objects.
- Features not meeting their sprint Definition of Done remain hidden or clearly disabled; they do not
  masquerade as completed surfaces.
- The first unauthenticated/free-user experience asks for a website URL and demonstrates a useful,
  bounded audit before demanding extensive setup.

## 5. Truth and Capability Contract

Every product/platform capability has one declared level:

| Level | Meaning | Allowed UI language |
| --- | --- | --- |
| `available` | End-to-end behavior is implemented, persisted, authorized, and tested | Connect, Schedule, Publish, Create paused draft, Apply change |
| `assisted` | Marpin creates a persisted draft/export and guides the user to finish elsewhere | Copy, Export, Download, Open in platform, Mark complete |
| `planned` | The workflow is not usable end to end | Coming soon or hidden; never a primary action |

Runtime connection state is separate: `connected`, `error`, or `revoked`. A connection is not proof
that every read or write capability is available; scopes and selected channel accounts decide that.

Truth rules:

- A button label describes what the click actually does.
- A provider action is successful only after its response is stored with an external ID or equivalent
  acknowledgement. Public posts also store a permalink when the provider supplies one.
- Assisted actions never use Publish, Launch, Schedule, or Connected as success language.
- Missing revenue, ROAS, conversion, or forecast inputs render as unavailable with the missing source,
  never as `0`.
- Demo data is visibly labeled and can run only in explicit demo mode.
- Forecasts stay out of production navigation until based on workspace data and accompanied by inputs,
  methodology, confidence, and limitations.
- Numeric and date claims include their evidence and timezone. Week plans use the workspace timezone
  and Monday as the default first day unless the user changes it.
- Public posting and any action that may spend money follow propose -> preview/diff -> approve ->
  execute. Paid activation requires a separate second approval.
- Errors are visible and recoverable. Long-running agent work has Stop and Retry controls, deadlines,
  and no endless loading state.

Canonical organic publication states:

`draft -> ready -> scheduled -> publishing -> published`

Failure and exit states are `failed` and `cancelled`. Each execution creates an append-only attempt;
retrying never erases the previous provider response or error.

## 6. Shared Domain Object Model

Manual UI, AI assistance, agent runs, background jobs, and API callbacks operate on the same records.

| Object | Responsibility and required relationships |
| --- | --- |
| Workspace | Tenant, timezone/locale/currency defaults, billing boundary, and data ownership |
| Membership | Workspace user with enforced owner/admin/member authorization |
| Brand | Website, audit, audience, positioning, offer, voice, proof, competitors, visual style, and context version |
| Conversation | Persistent workspace/brand thread with Assistant, Organic, SEO, or Paid context |
| Message | Server-owned immutable user/assistant turn with citations, artifacts, and run metadata |
| Integration | One encrypted OAuth authorization and its scopes/status |
| ChannelAccount | Selectable page, profile, channel, property, or ad account exposed by an Integration |
| ContentPlan | Week/month/quarter strategy with brand, objective, date range, channels, and timezone |
| ContentItem | Reusable master idea/brief/copy with source, lifecycle, approval, and version |
| Publication | Platform-specific variant, format, copy, schedule, channel account, and canonical state |
| Asset | Workspace-owned image/video with private storage key, metadata, provenance, and reuse links |
| PublicationAttempt | Append-only publish/schedule attempt with idempotency, provider response, error, and timestamp |
| Campaign | Paid campaign configuration for one launch platform; external or Marpin-created paused draft |
| Ad | Paid ad and creative belonging to a campaign, including a clearly dated performance snapshot |
| MetricFact | Canonical, revisable daily measurement fact with source, account, campaign, and metric grain |
| Action | Approval-bound command referencing a real domain object, never client-trusted free-form execution data |
| ActionAttempt | Immutable execution audit with actor, exact approved diff, provider result, and failure details |
| Subscription | Workspace plan, Stripe state, period, cancellation, and entitlements |
| UsageEvent | Idempotent integer usage record tied to a model/run and billing period |

Relationship invariants:

- One Integration can expose many ChannelAccounts. OAuth identity is not a publishing destination.
- One ContentItem can have many Assets and many platform-specific Publications.
- The calendar reads Publications; it does not maintain a second schedule state.
- Conversation artifacts reference persisted domain IDs. Reloading or switching views cannot lose work.
- Campaign and Ad records use stable internal/external IDs, not mutable names, for relationships.
- All tenant-owned rows carry workspace ownership and are authorized server-side.
- Secrets are encrypted at rest and never returned to the browser, logs, model, or analytics.

## 7. Manual, AI, and Agent Parity

Every core operation has three entry paths where appropriate:

| Path | User experience | Contract |
| --- | --- | --- |
| Manual | Forms, editors, calendar controls, uploads, filters, and approvals | Complete workflow without invoking AI |
| AI assist | Generate/rewrite one field, variant, image brief, or recommendation in context | User previews and accepts a bounded change |
| Agent | Execute a multi-step, goal-bounded plan across shared objects | Shows plan, progress, evidence, diffs, and approval points |

Parity rules:

- All paths call the same authorization, validation, persistence, entitlement, and capability services.
- AI never writes directly to a provider. It writes drafts or proposes Actions.
- AI output records source/model/run metadata; manual edits remain distinguishable and take precedence.
- A user can edit, replace, reject, duplicate, reschedule, or delete AI-created drafts manually.
- Agent batches are resumable and idempotent. Partial completion is visible item by item.
- Media generation uses a provider interface. Gemini/Nano Banana family models may be the first provider,
  but product data and UI do not hardcode a model name.
- Chat and product views update the same objects in near real time; neither is a read-only shadow of the
  other.

## 8. Strict Solo Founder Acceptance Journey

The release candidate fails if any required step depends on demo data, hidden developer intervention,
or a misleading capability label.

1. Create a new free account and land on a URL-first experience without an auth or redirect loop.
2. Submit a real company URL; see crawl progress, bounded failure states, sources, and a useful audit.
3. Review the detected Brand, correct a wrong identity, set Madrid timezone, audience, offer, and voice,
   then reload and confirm the context persists.
4. Ask the Assistant about the audit; stop a response, retry it, revisit the conversation after reload,
   and confirm no raw reasoning or irrelevant paid artifacts appear.
5. Open Organic and SEO and generate a 7-day plan for the next Monday-through-Sunday in Madrid time.
   All dates and weekday labels must agree.
6. Switch the same plan to a month view, add one idea manually, drag it to another day, and confirm the
   calendar persists without layout shifts.
7. Open a ContentItem, write one platform variant manually, generate another with AI, revise both, and
   preserve their shared idea and independent platform copy.
8. Upload an asset, generate an alternative through the configured media provider, add alt text, and
   reuse the asset on another Publication without exposing a public storage URL.
9. Schedule an approved Publication. If direct publishing is unavailable, receive an honest assisted
   handoff; if available, observe attempt status, provider acknowledgement, retry behavior, and permalink.
10. Open SEO, inspect prioritized technical/content findings backed by crawl/GSC/GA4 evidence, edit a
    task manually, ask AI for a fix, and mark the work complete without claiming an unverified site edit.
11. Connect/select accounts and view paid data only for Google Ads, Meta Ads, and TikTok Ads. Missing
    sources are unavailable, not zero; campaign and ad drill-downs are keyboard accessible.
12. Create a paid campaign manually and through AI, review targeting/creative/budget assumptions, and
    save it as a paused draft. No provider spend occurs.
13. Approve an exact paid change, inspect its audit trail, then separately approve activation where the
    API capability is available. Double-clicking must not duplicate the action.
14. Compare organic, SEO, and paid results in Analytics with visible source and date ranges.
15. Reach a Free entitlement, upgrade through Stripe to Solo Founder, return to a valid billing page,
    and confirm the entitlement changes only after a verified webhook.
16. Disconnect an integration, reconnect it, cancel billing, export/delete owned data, and verify the UI
    matches the resulting server state.
17. Repeat critical creation, scheduling, approval, and billing paths on desktop and mobile using only
    keyboard navigation where applicable, with no critical accessibility violations.

## 9. Definition of Done

Every sprint must satisfy these global gates:

- Manual and AI paths operate on shared persisted objects.
- Authorization, entitlements, validation, idempotency, and capability checks run server-side.
- Loading, empty, success, partial, failure, revoked, and retry states are designed and tested.
- Unit/integration tests cover domain logic; Playwright covers the sprint's critical user journey.
- Keyboard behavior, focus, accessible names, live errors, mobile layout, and reduced motion are verified.
- No secret, private asset URL, token, raw model reasoning, or sensitive provider response reaches logs/UI.
- Prisma migrations reproduce a clean database and are additive unless a reviewed migration says otherwise.
- Lint, typecheck, tests, migration validation, and production build pass in CI.
- Product copy and button labels pass the truth/capability contract.
- A real-data smoke test and visual screenshot review pass before the sprint is accepted.

Sprint-specific exit gates:

| Sprint | Done when |
| --- | --- |
| 0 - Contract and foundation | This contract, launch catalog, additive reproducible schema, authorization spine, and honest product scope are merged; dormant platforms and fake Forecast are absent from production UI |
| 1 - Trust and resilience | Chat has deadlines, Stop/Retry, visible typed errors, relevant artifacts, timezone grounding, safe activity text, and automated resilience/accessibility tests |
| 2 - Brand and memory | URL audit creates an editable Brand; conversations/messages/assets persist and survive reload; wrong-brand correction changes later AI context |
| 3 - Billing | Free and Solo Founder entitlements are enforced server-side; Stripe checkout/portal/webhooks and billing route work idempotently in production mode |
| 4 - Dual-mode workspace | Final collapsible IA, Organic/Paid context, connection management, and shared manual surfaces work on desktop/mobile |
| 5 - Calendar | Week/month calendar supports manual CRUD, drag/reschedule, filters, timezone-safe dates, conflicts, and persisted ContentPlan/Publication states |
| 6 - Content Studio | Manual and AI copy/variant workflows, private uploads, provider-neutral media generation, reuse, versions, and approvals work end to end |
| 7 - Organic publishing | Seven destinations show truthful direct/assisted capability; scheduling jobs, idempotent attempts, retries, failures, and permalinks work where APIs permit |
| 8 - SEO operating system | Crawl, GA4, and GSC produce sourced prioritized findings/tasks; users can edit/accept AI fixes and track outcomes without fake execution claims |
| 9 - Paid command center | Real account/campaign/ad reporting and drill-down work only for Google, Meta, and TikTok Ads, with correct unavailable states and source dates |
| 10 - Paid execution | Manual/AI drafts share schemas; provider validation, exact diffs, paused creation, audit attempts, and second activation approval work where reviewed APIs permit |
| 11 - Influencers | Search/import, qualification, CRM status, content brief, outreach draft, disclosure fields, and measurable campaign links work with honest vendor coverage |
| 12 - Closed-loop agents | Bounded agents create/update the same objects, expose evidence/progress, pause at approvals, resume safely, and learn only from verified outcomes |
| 13 - Production launch | Solo Founder journey passes against production-like accounts; security, privacy, observability, backups, support, legal, payments, performance, and rollback are signed off |

## 10. Deferred Scope

Deferred until after the initial production launch unless a launch sprint explicitly pulls it forward:

- LinkedIn, X, Microsoft Ads, Amazon Ads, Apple Search Ads, and all other networks.
- Fully autonomous publishing, ad activation, budget movement, or SEO changes.
- Enterprise SSO/SCIM, custom roles, legal holds, and multi-stage approval chains.
- Native mobile apps and offline editing.
- Full marketing-mix modeling, deterministic attribution, or guaranteed incremental-lift claims.
- An owned influencer marketplace, contracting, payments, or automated creator negotiation.
- In-house image/video foundation models and provider-specific editing features.
- SEMrush/Ahrefs enrichment until commercial terms, quotas, data rights, and graceful fallback exist.
- Business and Max packaging until Solo Founder pricing and unit economics are proven.

## 11. Owner and API Prerequisites

Engineering must keep assisted/manual paths usable while approvals are pending. External reviews do not
block honest product progress.

Owner decisions and accounts:

- Stripe production account, legal business identity, bank/tax/VAT settings, Solo Founder price, portal,
  refund/cancellation policy, and webhook endpoint.
- Production terms, privacy policy, cookie policy, data-deletion/export process, support email, company
  address, subprocessors, and retention periods.
- Approved Free and Solo Founder limits for AI credits, brands, seats, scheduled posts, storage, and
  connected accounts.
- Google AI Studio or Vertex project, billing/quota, production credentials, and approved initial media
  model; retain a provider-neutral interface.
- Vercel Production/Preview environment separation, Neon backup/restore, Inngest signing/event keys,
  private object storage, monitoring, alerting, and error tracking.

Platform prerequisites:

- Google: GA4 Data, Search Console, YouTube Data, and Google Ads APIs; production OAuth consent/scopes;
  Google Ads developer token Basic access; YouTube upload quota and verification where required.
- Meta: Business app, business verification, Marketing API, Facebook Pages, and Instagram content
  publishing permissions/review; test Page, Instagram professional account, and ad account.
- TikTok: Marketing API access plus separate Content Posting API audit/scopes; test organic and ad accounts.
- Pinterest: production app and required standard access/scopes for account selection and Pin publishing.
- Reddit: approved production OAuth app and posting/moderation scope review; test community rules and
  rate-limit behavior.
- Snapchat: documented production publishing route if available; otherwise launch as assisted with a
  clear export/handoff and no publish claim.
- Influencers: choose a compliant discovery/data vendor or define a manual import-first launch; approve
  outreach, privacy, consent, and sponsorship-disclosure policy.

For every provider, record app-review status, scopes, redirect URIs, rate limits, token refresh behavior,
test accounts, data-retention requirements, capability level, and fallback UX in an operational runbook.
