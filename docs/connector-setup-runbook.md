# Marpin connector setup runbook

_Generated 2026-06-24 from a 22-agent research+verify workflow (one researcher per app, each adversarially fact-checked against current official docs). Grounded in `src/lib/connectors/registry.ts`, `.env.example`, and `docs/marpin-action-os-plan.md`._

**What this is:** the exact, current-as-of-2026 steps to create Marpin's developer OAuth apps for all 13 platform keys (11 apps — Google serves `google_ads`+`ga4`+`search_console`), register redirect URIs, enable read scopes, request the write scopes that gate one-click execution, and capture each app's credentials for Vercel.

**What this is NOT:** an automated setup. Creating these apps requires signing into each platform's console, passing 2FA, accepting developer terms, and submitting business/identity verification — steps that must be done by a human account owner. Work each section logged into the relevant console; it's built to finish in minutes per platform once you're in.

> **Secrets handling:** after creating each app, paste its client id / secret into **Vercel → Settings → Environment Variables → Production** under the exact env-var names in the checklist below. Never commit a real secret to the repo.

---

## 0. Global prerequisites (do these ONCE, before any console)

These are cross-cutting and verified against the actual code, not assumed:

1. **Set `APP_URL` in Vercel Production to the canonical origin.** The OAuth code builds every `redirect_uri` as `` `${APP_URL}/api/connect/<platform>/callback` `` — see `buildRedirectUri()` in `src/app/api/connect/[platform]/route.ts:171` (`base = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin`). The redirect URI you register in **every** console must match this **character-for-character** (scheme + host + path, no trailing slash). The brief uses `https://www.marpin.ai` (with `www`), so set:
   - `APP_URL=https://www.marpin.ai`
   - (optionally) `NEXT_PUBLIC_APP_URL=https://www.marpin.ai`
   A `www` vs apex (`marpin.ai`) mismatch between `APP_URL` and the console is the #1 cause of `redirect_uri_mismatch`. Pick one canonical origin and use it everywhere.

2. **Verify domain ownership of `marpin.ai`** (DNS `TXT`) in Google Search Console. Required for the Google OAuth verification and reused/expected by several other platforms.

3. **Have these public URLs live** before submitting any review: homepage `https://www.marpin.ai`, a **privacy policy** URL, and a **terms of service** URL. Google, Meta, LinkedIn, and TikTok all require them on the review form.

4. **Redirect URIs — register BOTH per platform key** (prod + dev). For platform key `<key>`:
   - `https://www.marpin.ai/api/connect/<key>/callback`  (production)
   - `http://localhost:3000/api/connect/<key>/callback`  (local dev)
   Some consoles reject `http://` or `localhost` — where that's true it's called out in the platform section, and you use a tunnel (e.g. an https dev URL) instead.

5. **Per-platform redirect URIs are pre-computed** in each section below — copy them verbatim.

---

## 1. Executive summary — priority, review gate, ETA

Ordered by Phase-1 priority. "Confidence" is the verifier's confidence in that section's current accuracy.

| # | App | Phase-1 priority | Review / gate | Realistic ETA | Confidence |
|---|-----|------------------|---------------|---------------|------------|
| 1 | X / Twitter Ads (x_ads) | P1-WRITE (the one real executor — do FIRST) | App permissions review + AI/bot use-case review | Read + plain-text write, standard/non-AI use case: instant to a few hours (automated… | 🟢 high |
| 2 | Google | P1-read (gates live metrics) | Sensitive-scope OAuth app verification | ~3–10 business days for sensitive-scope OAuth verification (docs say up to 10), running… | 🟢 high |
| 3 | Meta | P1-read / P2-write (long-pole review) | App Review + Business Verification | Business Verification: 2-5 business days (can be longer if documents bounce). App… | 🟡 medium |
| 4 | LinkedIn Ads (linkedin_ads) | P1-read / P2-write (review) | Vetted product access + Business/Org verification + verified Page admin | READ (Advertising API) approval: ~3-10 business days after app is Page-verified… | 🟢 high |
| 5 | TikTok Ads (tiktok_ads) | P1-read / P2-write (audit) | App review + | Marketing API read: sandbox instant; production review 2-3 business days. video.publish… | 🟡 medium |
| 6 | Microsoft / Bing Ads (microsoft_ads) | P1-read | Self-serve (no review) | Azure app + secret: instant (minutes). Developer token: instant for first-party; up to… | 🟢 high |
| 7 | Amazon Ads (amazon_ads) | P1-read (Ads API onboarding is a long pole) | Amazon Ads API access request | LWA security profile + redirect URLs: instant. Amazon Ads API access request: no… | 🟢 high |
| 8 | Pinterest Ads (pinterest_ads) | P1-read | Standard access upgrade review | Trial approval: ~1 business day (reviewed each business day). Standard upgrade: ~5… | 🟡 medium |
| 9 | Snapchat Ads (snapchat_ads) | P1-read | Self-serve (no review) | instant (no review; OAuth app is created and credentials issued immediately) | 🟡 medium |
| 10 | Reddit Ads (reddit_ads) | P1-read | Ads API allowlist / partner onboarding | Basic OAuth app: instant (self-serve, credentials shown immediately). Reddit Ads API… | 🟡 medium |
| 11 | Apple Search Ads (apple_search_ads) | P1-read (different model — flag clearly) | Self-serve (no review) | Instant for the self-serve single-account path: generate keypair → paste public key →… | 🟢 high |

**Long poles to start first** (they gate real one-click execution and take the longest):
- **X / Twitter `tweet.write`** — Marpin's first real `api`-mode executor. Start here.
- **Meta** App Review + Business Verification (read *and* write).
- **LinkedIn** Community Management API access (write).
- **TikTok** Content Posting API audit (write).
- **Google Ads Developer Token** + sensitive-scope OAuth verification (gates live Google metrics).
- **Amazon Ads API** onboarding/allowlist (separate from the LWA app).

---

## 2. Vercel environment-variable checklist (Production)

Every credential to capture, deduped across apps. Paste into **Vercel → Settings → Environment Variables → Production**. Plus the global `APP_URL` from §0.

| Env var | What it is | Where to find it |
|---------|-----------|------------------|
| `APP_URL` | Canonical public origin; used to build every OAuth `redirect_uri` | Set manually to `https://www.marpin.ai` (see §0) |
| `X_CLIENT_ID` | OAuth 2.0 Client ID for the confidential web app. Public identifier sent in the authorize redirect and (for public clients) the token body; for Marpin's confidential client it is half of the Basic-auth credential at the token endpoint. | console.x.com → your Project → your App → Keys and tokens tab → 'OAuth 2.0 Client ID and Client Secret' section. The Client ID is shown there after you enable OAuth 2.0 via User authentication settings. |
| `X_CLIENT_SECRET` | OAuth 2.0 Client Secret for the confidential web app. Paired with X_CLIENT_ID to form the HTTP Basic 'Authorization' header at the token endpoint. Never leaves the server. | Same place: App → Keys and tokens → 'OAuth 2.0 Client ID and Client Secret' → click 'Regenerate'/'Generate' to reveal. SHOWN ONLY ONCE — copy immediately. If lost, regenerate (invalidates the old secret). |
| `GOOGLE_OAUTH_CLIENT_ID` | The OAuth 2.0 Web-application client ID for Marpin's single Google app. | Google Auth Platform → Clients → your Web client (https://console.cloud.google.com/auth/clients). Shown in the create dialog and on the client detail page. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | The OAuth client secret paired with the client ID (confidential web client; sent at token exchange). | Same client detail page; shown once on creation and retrievable via the client's download/reset secret action at https://console.cloud.google.com/auth/clients. |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Developer token authorizing Google Ads API calls (separate from OAuth). Required for any Ads API request; not used by GA4 or Search Console. | Google Ads Manager (MCC) account → Tools & Settings → Setup → API Center (https://ads.google.com/aw/apicenter). Starts as Test; apply for Basic Access for production. |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Optional. The 10-digit (no dashes) customer ID of the Manager (MCC) account, sent as the login-customer-id header when calling through an MCC. | Top-right of the Google Ads Manager account UI (https://ads.google.com), shown as XXX-XXX-XXXX; strip the dashes. |
| `META_APP_ID` | The app's public App ID (a.k.a. client_id) for the Marpin Business-type app. Used as client_id in both the authorize URL and the token exchange. | Meta App Dashboard > App Settings > Basic > 'App ID' (top of page). https://developers.facebook.com/apps/ > select app > App settings > Basic. |
| `META_APP_SECRET` | The app's App Secret (a.k.a. client_secret). Used in the server-side token exchange and the short→long-lived token swap. Also used to compute appsecret_proof if required. Server-only — never expose client-side. | Meta App Dashboard > App Settings > Basic > 'App Secret' — click 'Show', re-enter your Facebook password to reveal, then copy. |
| `LINKEDIN_CLIENT_ID` | OAuth 2.0 Client ID (a.k.a. API Key) for Marpin's single LinkedIn developer app. | developer.linkedin.com/apps > select the Marpin app > Auth tab > 'Application credentials' > Client ID. Copy the displayed value. |
| `LINKEDIN_CLIENT_SECRET` | OAuth 2.0 Client Secret (Primary). Sent in the token-exchange POST body. Keep server-side only. | Same Auth tab, directly under Client ID > 'Primary Client Secret'. Click the copy/eye icon to reveal and copy. Treat as a secret; do not put in URLs or client code. |
| `TIKTOK_APP_ID` | The Marketing API app's app_id (shown as 'App ID' in the business-api.tiktok.com portal). Sent in the portal/auth authorize URL and in the JSON token-exchange body as app_id. | business-api.tiktok.com/portal → My Apps → open your app → app detail header / Basic Information shows 'App ID'. |
| `TIKTOK_APP_SECRET` | The Marketing API app's secret. Sent in the JSON token-exchange body as secret (non-standard: not Basic auth). | business-api.tiktok.com/portal → My Apps → open your app → Basic Information → 'Secret' (click to reveal/copy; store immediately). |
| `MICROSOFT_ADS_CLIENT_ID` | The Azure app registration's Application (client) ID — a GUID like 00001111-aaaa-2222-bbbb-3333cccc4444. Sent as client_id in authorize + token requests. | Azure portal > App registrations > [your app] > Overview page > 'Application (client) ID' (copy icon). |
| `MICROSOFT_ADS_CLIENT_SECRET` | The confidential client secret VALUE for the web app. Sent as client_secret (url-encoded) in the token request body. | Azure portal > App registrations > [your app] > Manage > Certificates & secrets > New client secret. Copy the secret VALUE immediately on creation — it is shown only once and cannot be retrieved later. |
| `MICROSOFT_ADS_DEVELOPER_TOKEN` | Microsoft Advertising universal developer token, required in the DeveloperToken SOAP header on every Bing Ads API call (separate from OAuth). Not currently referenced in registry.ts isConnectorConfigured for microsoft_ads, but the client will need it at request time — add it to env/config before live reporting. | Microsoft Advertising Developer Portal > Account tab (https://developers.ads.microsoft.com/Account, or the newer https://ads.microsoft.com/cc/Settings/DevSettings) > sign in as Super Admin > Request Token. Sandbox universal token is BBD37VB98 for testing. |
| `AMAZON_ADS_CLIENT_ID` | OAuth Client ID of the Login with Amazon (LWA) security profile that has been granted the Amazon Ads API scope. | LWA console (developer.amazon.com/loginwithamazon/console) > your Security Profile > Web Settings tab > 'Client ID' field. Same value shown in the Ads Advanced Tools Center > Developer dashboard once API access is assigned. |
| `AMAZON_ADS_CLIENT_SECRET` | OAuth Client Secret paired with the LWA security profile; used to exchange the auth code and refresh tokens at https://api.amazon.com/auth/o2/token. | LWA console > your Security Profile > Web Settings tab > click 'Show Secret' next to 'Client Secret'. Treat as a server-only secret. |
| `PINTEREST_APP_ID` | OAuth client_id for Marpin's Pinterest developer app (Pinterest calls it 'App ID'). Public; sent as client_id on the authorize URL and as the username in the token-endpoint Basic auth header. | developers.pinterest.com/apps/ -> open the app -> the 'App ID' shown in the app details / Configure tab. Visible once the app is approved for Trial access. |
| `PINTEREST_APP_SECRET` | OAuth client_secret (Pinterest calls it 'App secret'). Secret; used as the password in the token-endpoint Basic auth header. | Same app details page as the App ID, shown as 'App secret'. Copy immediately and store in the secret vault — treat as a credential; regenerate from the app page if leaked. |
| `SNAPCHAT_CLIENT_ID` | OAuth client identifier for Marpin's Snapchat OAuth app (public). | Shown on the OAuth App detail page in Snap Business Manager immediately after you create the app (Business Details → OAuth Apps → your app). The Client ID remains visible/retrievable later. |
| `SNAPCHAT_CLIENT_SECRET` | OAuth client secret used in the token-exchange POST body. | Displayed ONLY ONCE at the moment of app creation in Snap Business Manager. Copy it immediately — it cannot be re-displayed. If lost, regenerate it (which invalidates all existing refresh tokens). If you create a second app for localhost, capture its own separate secret. |
| `REDDIT_CLIENT_ID` | The OAuth client identifier for Marpin's Reddit web app. Public-facing; sent as the HTTP Basic username at the token endpoint and as client_id in the authorize URL. | At https://www.reddit.com/prefs/apps, it is the short string shown directly UNDER the app name (just below 'web app'), with no field label. Copy that string. |
| `REDDIT_CLIENT_SECRET` | The OAuth client secret. Confidential; sent as the HTTP Basic password at the token endpoint. Never exposed to the browser. | At https://www.reddit.com/prefs/apps, the value labeled 'secret' in the app's detail panel. Use 'edit' on the app to reveal/regenerate it. |
| `APPLE_SEARCH_ADS_CLIENT_ID` | The OAuth client identifier Apple returns when you create the client, formatted 'SEARCHADS.<uuid>'. Used as the JWT 'sub' claim and the client_id token-request param. | Apple Ads → Account Settings → API tab → after pasting your public key and saving the client, Apple displays clientId, teamId, keyId. Copy clientId. |
| `APPLE_SEARCH_ADS_TEAM_ID` | The Apple Ads team identifier. Used as the JWT 'iss' (issuer) claim. NOT your Apple Developer Program Team ID — it is the value Apple shows in the API tab. | Apple Ads → Account Settings → API tab, displayed next to clientId/keyId after the client is created. |
| `APPLE_SEARCH_ADS_KEY_ID` | The key identifier (a UUID) bound to the public key you uploaded. Used as the JWT header 'kid'. | Apple Ads → Account Settings → API tab, shown with clientId/teamId after creating the client. If you upload multiple keys, each has its own keyId. |
| `APPLE_SEARCH_ADS_PRIVATE_KEY` | The EC P-256 (prime256v1) PRIVATE key in PEM whose PUBLIC half you pasted into Apple. Marpin signs the ES256 JWT client_secret with this. \n-escaped for env storage. | You generate it yourself: `openssl ecparam -genkey -name prime256v1 -noout -out private-key.pem`. Apple never shows it. Store the PEM contents; you upload only the public key (`openssl ec -in private-key.pem -pubout -out public-key.pem`). |

---

## 3. Cross-cutting caveats (from adversarial verification)

Things the verifiers flagged as time-sensitive or worth re-checking at implementation time:
- **All review ETAs are optimistic.** Platforms quote best-case days; real-world waits (especially Meta business verification, Google Ads developer-token backlog, Amazon Ads onboarding) routinely run longer. Treat the table as a floor.
- **Write-scope tiers and prices move.** Confirm the live X developer tier required for `tweet.write` (and its monthly price) at signup — it's the most volatile single fact in this doc.
- **Google Ads API version is pinned and sunsets on a rolling schedule** — bump the pinned version before its sunset or Ads calls start failing; this is independent of OAuth/verification status.
- Per-section `> ⚠️ Verify:` callouts and the per-app uncertainty lists below mark the specific claims to re-confirm.

---

## 4. Per-platform runbooks

## X / Twitter Ads (x_ads) — PHASE 1 PRIORITY: first real one-click executor

**Why this is P0:** `tweet.write` is the single clean OAuth 2.0 user-context POST (`POST /2/tweets`) that turns Marpin from a read-only analyst into a real api-mode executor. Unlike Meta/Google, there is no multi-week business verification — the only hard gates are billing and (because Marpin is an AI product) an AI/bot use-case review. *(Verified: POST /2/tweets on api.x.com, OAuth 2.0 user context + tweet.write, no business verification — confirmed against docs.x.com.)*

**Repo-authoritative values (do NOT change — build the console to match):**
- Platform key: `x_ads`
- Authorize URL (repo): `https://twitter.com/i/oauth2/authorize` · Token URL (repo): `https://api.twitter.com/2/oauth2/token`
- Read scopes: `tweet.read`, `users.read`, `offline.access` · Write (Phase 1): `tweet.write`
- PKCE: true (S256) · Token auth: HTTP Basic · Env: `X_CLIENT_ID`, `X_CLIENT_SECRET`
- Redirect URIs to register (both): `https://www.marpin.ai/api/connect/x_ads/callback` and `http://localhost:3000/api/connect/x_ads/callback`

> ⚠️ **Host drift:** X's current canonical hosts are `https://x.com/i/oauth2/authorize` and `https://api.x.com/2/oauth2/token` (confirmed against the official OAuth docs). The repo's `twitter.com`/`api.twitter.com` hosts are no longer the documented canonical.
> ⚠️ **Verify:** The claim that the legacy `twitter.com` / `api.twitter.com` hosts "still resolve and will work today" is NOT confirmed by any primary source — the X changelog has no migration entry or sunset date, and the docs no longer document the legacy hosts. Do not assume they work; test directly before launch, and prioritize swapping registry.ts to the `x.com` hosts. Do not change registry.ts as part of this task — just track it.

### 1. Create the app (console.x.com)
1. Go to **https://console.x.com/** and sign in with the Marpin company X account (this account owns the single shared app; customers connect THEIR accounts through it).
2. **Projects & Apps** → open (or create) your **Project** → **Add App** / **Create App**. Give it a globally-unique name, e.g. `Marpin Production`. (App names are unique across all of X — namespace it.)
3. You land on **Keys and tokens** showing API Key/Secret and Bearer (OAuth 1.0a artifacts — Marpin does NOT use these for posting). Leave them; we need the OAuth 2.0 pair, configured next.

### 2. Configure OAuth 2.0 (User authentication settings)
4. Open the app → **Settings** tab → find **User authentication settings** → click **Set up**.
5. **App permissions:** select **Read and write**. (Required — if left at "Read", `tweet.write` is silently missing from every issued token. Do NOT add Direct Message for Phase 1.)
6. **Type of App:** select **Web App, Automated App or Bot** → this makes it a **confidential client** and is what yields a **Client Secret** (needed for Basic-auth token exchange). Do NOT pick Native/SPA (public client, no secret). *(Confidential vs public-client distinction confirmed against current sources.)*
7. **App info → Callback URI / Redirect URL:** paste BOTH, exactly:
   - `https://www.marpin.ai/api/connect/x_ads/callback`
   - `http://localhost:3000/api/connect/x_ads/callback`
   Exact match is enforced; `http://localhost` is the only non-https allowed; everything else must be https.
   > ⚠️ **Verify:** the exact trailing-slash/scheme+host+path matching rule is X's documented long-standing behavior but was not re-confirmed verbatim from a current 2026 primary page — confirm in-console that the saved URIs match your app's redirect byte-for-byte (including any trailing slash).
8. **Website URL:** `https://www.marpin.ai`. (Terms/Privacy URLs optional but recommended: `https://www.marpin.ai/terms`, `https://www.marpin.ai/privacy`.)
9. **Save.**

### 3. Capture credentials
10. Go to the app's **Keys and tokens** tab → **OAuth 2.0 Client ID and Client Secret** section.
    - Copy **Client ID** → `X_CLIENT_ID`.
    - Click **Generate**/**Regenerate** to reveal the **Client Secret** → `X_CLIENT_SECRET`. **Shown only once** — copy immediately; if lost, regenerate (invalidates the old one).
11. Put both in Marpin's secret store / `.env`:
    ```
    X_CLIENT_ID=...
    X_CLIENT_SECRET=...
    ```

### 4. Scopes — confirmed against current docs (no mismatch)
All four repo scopes are current 2026 identifiers and need no separate "enable" toggle — they are requested per-authorization in the `scope` query param. Confirmed valid against docs.x.com: `tweet.read`, `users.read`, `offline.access`, `tweet.write` (the minimum set to post on a user's behalf is tweet.read + tweet.write + users.read). `offline.access` is what issues a **refresh token** (without it, access tokens die in ~2h — confirmed). ✅ Registry matches the platform — no scope renames.

### 5. Billing — the real gate (do this before any call)
Since **Feb 6 2026**, **pay-per-use is the default and only path** for new developers (confirmed in the X changelog: pay-per-use officially launched Feb 6, 2026). No free tier; no new Basic/Pro subscriptions for new developers (legacy Basic/Pro remain only for existing subscribers).
- In the console: **Billing / Usage** → **add a payment method** and **load credits**. You CANNOT make any call (read or write) without a funded balance.
- Current rates (verify in-console before launch — "Prices are subject to change" per X's pricing page): **post create $0.015**, **post create with a URL $0.20**, **post read $0.005/resource**, summoned post $0.010. *(All confirmed against docs.x.com/x-api/getting-started/pricing and the changelog's April 20, 2026 update.)*
   > ⚠️ **Verify:** the April 20, 2026 update also introduced a cheaper **"Owned Reads"** rate (~**$0.001**/resource) for reading your own/connected-account content. Since Marpin reads the connected owner's own posts/metrics, it may qualify for this lower read rate rather than the standard $0.005 — confirm which read rate applies in the console.
- Budget note: any approved Marpin post containing a link costs ~13× a plain post ($0.20 vs $0.015). Surface this in the approval UI / cost controls.

### 6. App review / AI use-case attestation
- **Read by third-party accounts:** no App Review, no business verification. Customers just complete the standard OAuth consent screen.
- **Write (`tweet.write`):** no separate write-scope App Review either. BUT during app/use-case setup X asks how you use the API. Marpin self-identifies as AI, which **triggers an additional AI/bot use-case review** (standard non-AI use cases auto-approve). *(Confirmed: standard cases auto-approve; AI/bot cases get additional review.)*
- **AI-generated replies** require **explicit prior written approval from X** — confirmed in the X Developer Guidelines ("Deploying AI-generated replies without approval is a violation, even if the content itself is helpful"). This is handled via X's **Policy Support form (https://help.x.com/forms/platform)**, NOT a widget inside the developer console. Out of scope for Phase 1; keep Marpin to user-approved standalone posts, not auto-replies.

**Ready-to-paste use-case / review answers (tailor in the console form):**
- *What does your app do?* "Marpin (https://www.marpin.ai) is an AI marketing operating system. Businesses connect their own X account via OAuth 2.0. Marpin reads their public post and account metrics to provide analytics, and publishes marketing posts that the account owner has explicitly reviewed and approved, one action at a time."
- *Will you display X content off-platform?* "Only the connected owner's own metrics/posts, shown back to that same owner in their Marpin dashboard."
- *Do you use AI to generate content?* "Yes — Marpin drafts post copy with AI, but nothing is published automatically. Every post requires explicit per-action human approval by the account owner before `POST /2/tweets` is called. We do not generate or post automated replies."
- *Automation / volume?* "Low volume, human-in-the-loop. One post per explicit user approval. No bulk posting, no auto-reply, no engagement automation."

**Hard gates summary:** funded pay-per-use balance (required) · AI/bot use-case review (Marpin triggers it) · no business verification · no linked Business/Page · no separate API onboarding/allowlist beyond billing. *(All confirmed.)*

**ETA:** Read + plain-text write for a standard use case is near-instant once billing is set. With the AI/bot review, budget **1–10 business days**.
> ⚠️ **Verify:** the "1–10 business days" figure is a reasonable estimate, not a published X SLA. Treat it as planning guidance, not a commitment. AI auto-replies (excluded from Phase 1) need separate written sign-off via the Policy Support form.

### 7. OAuth-flow gotchas (will break the implementation if missed)
- **PKCE required:** authorize with `code_challenge` + `code_challenge_method=S256`; token exchange sends the matching `code_verifier`. Use S256, not plain. (`usesPkce:true` ✅)
   > ⚠️ **Verify:** X's official OAuth example currently shows `code_challenge_method=plain` and only advises a "random string" in production — it does NOT explicitly mandate S256, and X still technically accepts `plain`. S256 is the correct, OAuth-2.1-aligned choice and is accepted by X, so keep S256 — but the framing "X requires S256" overstates the docs.
- **Confidential client → Basic auth at token endpoint:** `Authorization: Basic base64(X_CLIENT_ID:X_CLIENT_SECRET)`, `Content-Type: application/x-www-form-urlencoded`. Do NOT put client_id/secret in the body. (`tokenAuthStyle:"basic"` ✅ — confirmed against docs.)
- **Refresh tokens rotate (single-use):** each refresh is expected to return a NEW `refresh_token`; persist the new one and discard the old. `offline.access` must be in scope to get one.
   > ⚠️ **Verify:** single-use rotation is X's documented historical behavior but was not re-confirmed from a current 2026 primary page in this pass — handle rotation defensively (always persist the returned refresh_token) and verify empirically.
- **Permission ordering:** set **Read and write** BEFORE issuing tokens; changing it later forces all users to re-authorize.
- **No Test-vs-Live app mode** like Meta — the gate is the funded billing balance, not a mode switch. The same app serves all connected customers.
- **Exact redirect match** incl. trailing slash; https-only except `http://localhost` (verify exactness in-console, see §2.7).

**Sources:** docs.x.com/x-api/getting-started/pricing · docs.x.com/changelog · docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token · docs.x.com/x-api/posts/creation-of-a-post · docs.x.com/developer-guidelines · developer.x.com/en/support/x-api/policy

> **Verification:** confidence 🟢 high. Re-confirm at implementation time:
> - Legacy host resolution (Claim 4): The assertion that twitter.com / api.twitter.com 'still resolve and work today' is NOT backed by any primary source — the X changelog has no migration/deprecation entry for these hosts. Canonical x.com/api.x.com hosts ARE confirmed. Test legacy-host behavior directly before relying on it.
> - PKCE S256 mandate: X's official OAuth example currently uses code_challenge_method=plain and only recommends a random string in production; it does not explicitly mandate S256, and plain is still accepted. The runbook's 'X requires S256' overstates the docs (S256 is still the right choice).
> - Refresh-token single-use rotation: documented historically but not re-confirmed from a current 2026 primary page in this pass. Handle rotation defensively and verify empirically.
> - Redirect-URI exact-match / trailing-slash rule: consistent with X's long-standing behavior but not restated verbatim on a current primary page; confirm byte-for-byte match in the console.
> - '1–10 business days' AI/bot review ETA is a reasonable planning estimate, not a published X SLA.
> - Read pricing nuance: standard read is $0.005/resource (confirmed), but the April 20 2026 update added a cheaper 'Owned Reads' rate (~$0.001) that may apply to Marpin reading the connected owner's own content — confirm which rate applies in-console.
> - OAuth 1.0a is not strictly obsolete for posting: POST /2/tweets accepts BOTH OAuth 1.0a User Context and OAuth 2.0 User Context. OAuth 2.0 is fully supported/recommended, but 1.0a is not 'no longer required/accepted' — it remains a valid alternative.

---

## Google — Ads + GA4 + Search Console (ONE OAuth app)

One Google Cloud project + one OAuth 2.0 "Web application" client serves all three Marpin platform keys (`google_ads`, `ga4`, `search_console`). Customers connect their own Google accounts through this single app. **Phase 1 is read-only** — no write/post scopes are requested.

**Repo-authoritative values (do NOT change — the console must match these):**
- Authorize URL: `https://accounts.google.com/o/oauth2/v2/auth`
- Token URL: `https://oauth2.googleapis.com/token`
- PKCE: **on**; authorize also sends `access_type=offline` + `prompt=consent`
- READ scopes: `https://www.googleapis.com/auth/adwords`, `https://www.googleapis.com/auth/analytics.readonly`, `https://www.googleapis.com/auth/webmasters.readonly`
- WRITE scopes: **NONE** in Phase 1

**Scope-identifier check vs Google's current docs — ALL THREE MATCH the repo exactly. No mismatch.** (Verified: the Search Console API docs list `auth/webmasters.readonly` as the read-only scope; GA4's `analytics.readonly` and the Ads `adwords` scope strings are current.)
- `adwords` → **SENSITIVE** scope (Google Ads/AdWords API; Google officially upgraded it to "sensitive" in 2020). Triggers OAuth app verification. Does NOT trigger CASA.
- `analytics.readonly` → **SENSITIVE** scope (GA4 / Analytics Data + Admin APIs). Triggers OAuth app verification.
- `webmasters.readonly` → **NON-sensitive** (Search Console; not flagged sensitive in Google's current scopes table). On its own it needs no verification, but it rides along on the app that already requires verification for the two sensitive scopes.
> ⚠️ Verify: the "reclassified in 2024" date for `webmasters.readonly` is sourced from integration vendors, not a dated Google changelog — the non-sensitive status is current, but treat the exact year as approximate. Both this and the Ads classification can change if Google re-tiers scopes.

> ⚠️ Correction to the repo engineering note: none of these three is a **restricted** scope (restricted = broad Gmail/Drive/Calendar/Photos data). **CASA / a third-party security assessment is NOT required.** What is required is standard **sensitive-scope OAuth verification** (justification + demo video), which is free.
> ⚠️ Verify: CASA is triggered only by RESTRICTED scopes whose data is stored/transmitted on servers; restricted-scope apps must additionally re-assess at least every 12 months (paid, ~hundreds–thousands USD/yr). If Google ever reclassifies `adwords` as restricted, that paid CASA + annual re-assessment would apply.

### Step 1 — Create the project and enable the APIs
1. Create a project: https://console.cloud.google.com/projectcreate → name it e.g. `marpin-prod`.
2. Enable the three APIs (APIs & Services → Library, or direct links):
   - Google Ads API → https://console.cloud.google.com/apis/library/googleads.googleapis.com
   - Google Analytics Data API → https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com (and Analytics Admin API: `analyticsadmin.googleapis.com`)
   - Search Console API → https://console.cloud.google.com/apis/library/searchconsole.googleapis.com

### Step 2 — Configure the OAuth consent screen / branding
Google Auth Platform → Branding: https://console.cloud.google.com/auth/branding
1. **User type / Audience = External** (so any customer's Google account can connect).
2. App name: `Marpin`. User support email: a real monitored address. App logo: Marpin logo.
3. App home page: `https://www.marpin.ai`. Privacy policy: `https://www.marpin.ai/privacy`. Terms: `https://www.marpin.ai/terms`. (Homepage and privacy policy must be live and reachable; the privacy policy must be hosted on the SAME domain as the homepage and linked from the consent screen — verification fails otherwise.)
4. **Authorized domains**: add `marpin.ai`. You must verify ownership of `marpin.ai` in Google Search Console (https://search.google.com/search-console) — DNS TXT or HTML-file; do this early, it gates verification.
5. Developer contact email: a monitored address.

### Step 3 — Add the scopes (Data Access)
Google Auth Platform → Data Access: https://console.cloud.google.com/auth/scopes → "Add or remove scopes" → paste these three manually (use "Manually add scopes" if they aren't pre-listed), then Update + Save:
```
https://www.googleapis.com/auth/adwords
https://www.googleapis.com/auth/analytics.readonly
https://www.googleapis.com/auth/webmasters.readonly
```
The first two will be tagged "Sensitive" in the table; that's expected. `webmasters.readonly` will NOT carry a sensitive tag.

### Step 4 — Create the OAuth client (Web application)
Google Auth Platform → Clients: https://console.cloud.google.com/auth/clients → **Create client** → Application type = **Web application** → Name `Marpin Web`.
- **Authorized redirect URIs** — under "Authorized redirect URIs" click **Add URI** for EACH (register all six, exact match, no trailing slash):
```
https://www.marpin.ai/api/connect/google_ads/callback
http://localhost:3000/api/connect/google_ads/callback
https://www.marpin.ai/api/connect/ga4/callback
http://localhost:3000/api/connect/ga4/callback
https://www.marpin.ai/api/connect/search_console/callback
http://localhost:3000/api/connect/search_console/callback
```
  (HTTPS required for prod; `http://localhost` is the only allowed plaintext exception. No "Authorized JavaScript origins" needed — this is a server-side auth-code flow.)
- Click **Create**. A dialog shows the **Client ID** and **Client secret** — copy both now (the secret is also retrievable later via the client's "Download/Reset" actions). Capture:
  - `GOOGLE_OAUTH_CLIENT_ID` = the Client ID
  - `GOOGLE_OAUTH_CLIENT_SECRET` = the Client secret

### Step 5 — Publish to Production (lifts the 100-user cap; fixes refresh tokens)
Google Auth Platform → Audience: https://console.cloud.google.com/auth/audience → **Publish app** to move from Testing → "In production".
> Critical: while in **Testing**, refresh tokens for sensitive scopes **expire after 7 days** and you're capped at 100 manually-added test users. Marpin's offline/refresh model breaks until the app is published + verified. Verification is what removes the cap and the "unverified app" warning screen.

### Step 6 — Submit for OAuth verification
After publishing, Google Auth Platform → Verification Center shows "Needs verification". Submit and answer the form (see structured fields for ready-to-paste justifications). You'll need: live homepage + same-domain privacy policy, verified domain, per-sensitive-scope justification (for `adwords` and `analytics.readonly`), and a screen-recorded demo video (uploaded UNLISTED to YouTube) showing a user clicking Connect, the Google consent screen with these scopes, and Marpin then displaying the read-only metrics those scopes return. **No CASA.** ETA: Google's docs say "up to ~10 days" (its stated maximum — calendar days, not explicitly business days); real timelines vary and often run longer.

### Step 7 — Google Ads Developer Token (separate, required for any Ads API call)
The OAuth client + verification are NOT enough to call the Google Ads API — you also need a developer token (separate from OAuth and independent of OAuth verification):
1. Use/create a **Google Ads Manager (MCC)** account: https://ads.google.com/home/tools/manager-accounts/
2. In that MCC: **Tools & Settings → Setup → API Center** (https://ads.google.com/aw/apicenter) → fill the API access form.
3. Token starts at **Test** access. Apply for **Basic Access** (production, 15,000 ops/day cap — sufficient for Marpin's read-only reporting). When applying, declare the **"Reporting" permissible use** (read-only: `GoogleAdsService.Search`/`SearchStream` only) — this matches Phase 1 and eases approval. Standard Access (unlimited) only if you outgrow Basic. Note: an intermediate **Explorer Access** tier (2,880 ops/day, auto-provisioned, no formal application) now exists and can serve as a stopgap while Basic is pending.
4. Capture `GOOGLE_ADS_DEVELOPER_TOKEN`. If calls go through the MCC, also set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` = the MCC's 10-digit customer ID (no dashes); optional otherwise.
- ETA (2026): Google's stated TARGET for Basic Access is ~2 business days, but Google acknowledged a backlog (Feb 2026) pushing reviews well past that — budget up to ~10 business days and possibly weeks, with advertiser-verification checks on accounts under your MCC. Apply early.

GA4 and Search Console need NO separate token — the OAuth access token alone authorizes them.

### Env vars to capture
- `GOOGLE_OAUTH_CLIENT_ID` — OAuth client ID (Step 4)
- `GOOGLE_OAUTH_CLIENT_SECRET` — OAuth client secret (Step 4)
- `GOOGLE_ADS_DEVELOPER_TOKEN` — from Ads API Center (Step 7)
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID` — MCC 10-digit id, optional (only if calling via an MCC)

### OAuth-flow gotchas (these break Marpin if wrong)
- **PKCE**: Google supports PKCE on the web auth-code flow — keep it on, but you STILL must send the client secret at token exchange (Google web clients are confidential; PKCE is additive, not a replacement).
- **Refresh tokens**: only returned when `access_type=offline` AND `prompt=consent` are sent at authorize time (already in `extraAuthorizeParams`). Without `prompt=consent`, repeat authorizations return no new refresh token. Store the refresh token on first grant.
- **Token endpoint auth**: send `client_id` + `client_secret` in the POST **body** (`application/x-www-form-urlencoded`) along with the PKCE `code_verifier`. Google accepts body credentials; HTTP Basic also works but body is the documented default.
- **Testing vs Production mode**: must be **In production + verified**, or refresh tokens expire in 7 days and only 100 test users can connect.
- **Redirect URIs**: exact string match — scheme, host, path all compared literally; no trailing slash, no wildcards. HTTPS only except `http://localhost`. Edits can take 5 min–few hours to propagate.
- **No API version pinning in OAuth**, but the Google Ads API itself is versioned (e.g. `/v24/`) and deprecates old versions on a rolling cadence — as of Jan 2026 the Ads API ships MONTHLY with each major version supported ~1 year. Pin a current version (v24 at time of writing; do NOT use v21, which sunsets Aug 2026) and bump it before sunset or Ads calls fail. GA4 Data API and Search Console API are unversioned-stable by comparison.
- **Per-customer consent**: each end customer grants the scopes for their own accounts; the developer token + MCC are Marpin's, the OAuth tokens are the customer's.
> ⚠️ Verify: this section covers ONLY Google read scopes. WRITE-capability gates for other platforms (X tweet.write paid tier, Meta Advanced Access + business verification, LinkedIn Community Management API eligibility, TikTok Content Posting audit) are out of scope here and unverified in this review — Phase 1 requests no write scopes on Google, so no Google write-gate applies.

> **Verification:** confidence 🟢 high. Re-confirm at implementation time:
> - webmasters.readonly non-sensitive status is current (not flagged sensitive in Google's scopes table), but the specific '2024 reclassification' date is sourced from integration vendors, not a dated Google changelog — treat the year as approximate.
> - Sensitive-scope verification ETA: Google's docs phrase the maximum as 'up to 10 DAYS' (calendar days), not explicitly 'business days' as the runbook stated — and real-world times frequently exceed it. Treat 10 as an optimistic max, not a typical case.
> - Google Ads Basic Access target IS ~2 business days per Google's docs, but the Feb 2026 PPC.land report (and community threads) indicate actual waits run from several days to weeks during the backlog; the upper bound is genuinely uncertain.
> - Ads API version: 'v21' in the original is stale. Current is v24 with v22/v23 live; monthly cadence began Jan 2026 and v21 sunsets Aug 2026. The exact 'current' version will keep moving — re-check the sunset-dates page at implementation time.
> - Write-capability access requirements for non-Google platforms (X, Meta, LinkedIn, TikTok) were not verified in this review because the section under review is Google-only and Phase 1 requests no write scopes; those gates should be fact-checked separately when their sections are reviewed.
> - Could not load Google's authoritative scope-classification FAQ table directly (the fetched FAQ page did not enumerate per-scope sensitivity); the adwords=sensitive classification is confirmed via Google's 2020 Ads Developer Blog announcement and the consent-screen 'Sensitive' tag behavior rather than the FAQ list itself.

---

## Meta — Facebook + Instagram Ads (meta_ads, ONE app)

One Business-type Meta app serves the `meta_ads` platform key. Customers sign in with Facebook Login (see Facebook Login for Business note below) and grant Marpin access to THEIR own ad accounts, Pages, and Instagram accounts. Read (metrics) and write (approved posting/ad creation) are both gated behind App Review + Business Verification.

> ⚠️ Verify: Two DIFFERENT gating systems are easy to conflate here. (1) PERMISSION access levels (Standard/Advanced — Advanced now also surfaced as "Full"): control whether a scope works on OTHER users' assets, and Advanced requires App Review + Business Verification. (2) The "Marketing API Access Tier" feature — renamed from "Ads Management Standard Access" effective **May 4, 2026** (tiers relabeled Standard/Advanced → **Limited/Full**) — controls Marketing API CALL VOLUME / rate limits, NOT permission grants. The May 4 rename lowered the qualifying threshold (1,500 → 500 calls/15 days) and dropped the screen-recording upload **for that tier only**. It did NOT remove App Review or Business Verification for ads_*/business_management permissions.

**Verified against current Meta docs (2026):**
- Marketing API Get Started / Authentication: https://developers.facebook.com/docs/marketing-api/get-started/authentication/
- Permissions Reference: https://developers.facebook.com/docs/permissions/
- Facebook Login for Business: https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business
- Instagram content publishing: https://developers.facebook.com/docs/instagram-platform/content-publishing/
- Strict OAuth URI matching: https://developers.facebook.com/blog/post/2017/12/18/strict-uri-matching/
- Long-lived tokens: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/
- App Modes (Dev vs Live): https://developers.facebook.com/docs/development/build-and-test/app-modes/
- Graph API versions (confirm v25.0 live): https://developers.facebook.com/docs/graph-api/changelog/versions/
- "Marketing API Access Tier" rename (May 4, 2026): https://developers.meta.com/blog/updates-to-ads-management-standard-access-feature/

Repo values (registry.ts) MATCH the current console for the endpoints/scopes pinned:
authorize `https://www.facebook.com/v25.0/dialog/oauth`, token `https://graph.facebook.com/v25.0/oauth/access_token`, READ scopes `ads_read` + `business_management`, PKCE off, body credentials, env `META_APP_ID` / `META_APP_SECRET`.

> ⚠️ Verify: If the app is created as **Facebook Login for Business** (the 2026 default for new Business apps, see §2/§3), the classic authorize URL with a comma-separated `scope` param may need a **`config_id`** instead, and scopes may be defined by a saved Configuration rather than the `scope` string. registry.ts currently builds a classic authorize URL with no `config_id` — confirm against the live app's login product before relying on it.

### 1. Create the app
1. Go to **https://developers.facebook.com/apps/** → **Create app**.
2. Use case / type: choose **Other** → **Business** (Business is the only type that supports the Marketing API product). Name it "Marpin", set the contact email.
3. Associate it with your **Business Manager** (Business portfolio) account when prompted — or link later under **App settings → Advanced → Business account**. Without this link, tokens won't reach the customer's ad-account data even with correct scopes.

### 2. Add products
4. In the left rail **Add product**:
   - **Facebook Login for Business** — for new Business-type apps this is the path Meta steers you to, and **newly created Business apps cannot roll back to classic Facebook Login**. FLB uses a **Configurations** menu (Create from template or custom) and a **`config_id`** in the login dialog. (Classic **Facebook Login** still exists for older apps but may not be selectable for a brand-new Business app.)
   - **Marketing API** (enables the ads_* permissions + token endpoints).
   - For Instagram publishing add the **Instagram** product configured for **"Instagram API with Facebook Login"** (this is the track that uses `instagram_content_publish`; the standalone "Instagram Graph API" label has been folded into the Instagram product). The separate **"Instagram API with Instagram Login"** track uses a DIFFERENT permission, `instagram_business_content_publish`, and is NOT what registry.ts targets.
   - Publishing requires an Instagram **Professional (Business or Creator)** account **connected to a Facebook Page** — a personal IG account cannot publish via API.

> ⚠️ Verify: in the live App Dashboard, confirm which login product the app has (FLB vs classic) — this determines where redirect URIs live (§3) and whether `config_id` is mandatory in the authorize URL.

### 3. Register redirect URIs (EXACT)
5. **For classic Facebook Login:** Left rail → **Products → Facebook Login → Settings** → **Client OAuth Settings** → **Valid OAuth Redirect URIs**. **For Facebook Login for Business:** the Valid OAuth Redirect URIs are set in the **FLB product settings / within the Configuration**, not the classic pane. Paste BOTH, one per line, then **Save changes**:
   - `https://www.marpin.ai/api/connect/meta_ads/callback`
   - `http://localhost:3000/api/connect/meta_ads/callback`
   Strict matching is on: the `redirect_uri` you send must match a listed value byte-for-byte (no prefix match, trailing-slash or query-string drift fails). Production redirect URIs must be **https** (localhost over http is allowed for dev). Keep **Client OAuth Login** and **Web OAuth Login** toggles ON.

> ⚠️ Verify: exact pane location for redirect URIs depends on FLB vs classic — confirm in the live console.

### 4. Grab credentials → env
6. **App settings → Basic**: copy **App ID** → `META_APP_ID`. Click **Show** next to **App Secret** (re-enter your FB password) → copy → `META_APP_SECRET` (server-only).
7. While on **Basic**, set the **Privacy Policy URL** (`https://www.marpin.ai/privacy`) and a **Data Deletion Request** callback URL (HTTPS; on a deletion request Meta POSTs a signed_request and expects a JSON response with a confirmation code + status URL) — both are required before you can submit for review.

### 5. Scopes — confirm current identifiers (all MATCH repo)
| Scope | Tier | Console identifier (verified) | Marpin use |
|---|---|---|---|
| `ads_read` | READ | matches | Read ad insights/metrics from connected ad accounts |
| `business_management` | READ | matches | Enumerate/claim Business assets (ad accounts, Pages) |
| `pages_manage_posts` | WRITE | matches | Publish approved Page posts |
| `instagram_content_publish` | WRITE | matches (Facebook-Login track) | Publish approved IG feed photo/video |
| `ads_management` | WRITE | matches | Create/edit campaigns on approval |

All five identifiers are spelled correctly and currently exist. Scopes are passed comma-separated in the `scope` param of the authorize URL **(classic FB Login)** — under FLB they may instead come from the saved Configuration via `config_id`.

> ⚠️ Verify: this list likely needs **`pages_show_list`** and **`instagram_basic`** added in practice — you cannot enumerate the user's Pages / linked IG Professional accounts (to find the IG user ID and Page to publish to) with only the five scopes above. Confirm against the actual MetaAdsClient code paths.

### 6. App Review + Advanced Access (required for READ and WRITE on customers' accounts)
For ANY user other than your app's Admin/Developer/Tester roles, every scope above needs **Advanced Access**, which requires **App Review** and (for ads_*/business_management/ads_management) **Business Verification**. Standard/"Limited" Access only works on assets you administer.

8. **Business Verification first** — Meta **Business Settings → Security Center** (in Business Manager, not the App Dashboard): submit legal business name, address, and documents; verify domain `marpin.ai`. **ETA ~5–15 business days** (longer for restricted verticals / high-volume periods). Link the verified Business to the app (App settings → Advanced).
9. **Request Advanced Access** — App Dashboard left rail → **App Review → Permissions and Features**. Find each permission, make **at least 1 successful API call** with it (a prerequisite to unlock the request), then click **Request Advanced Access**. For each, provide the use-case write-up + a **screencast** showing a real user connecting via Facebook Login and the exact feature using that permission. (Static screenshots are NOT accepted; the screencast must show the full flow login → account connection → feature.)

> ⚠️ Verify: the per-permission App Review screencast is STILL required in 2026. Do NOT assume the May 4, 2026 "screen-recording no longer required" change applies here — that exemption is only for qualifying for the Marketing API Access Tier (call-volume/rate-limit feature), not for permission App Review.

10. Flip the app to **Live** (top toggle) before customers can grant anything. In **Development** mode only Admin/Dev/Tester roles can connect — fine for testing against your own ad account.

**Ready-to-paste review answers (tailored to Marpin):**
- *What does your app do?* "Marpin (https://www.marpin.ai) is an AI marketing operating system. Businesses sign in and connect their own Meta ad accounts, Facebook Pages, and Instagram accounts. Marpin reads their advertising and organic performance metrics and surfaces AI recommendations."
- *ads_read / business_management:* "We call the Ad Insights and Business Manager APIs to read the connecting user's own ad-account performance (spend, impressions, conversions) and to enumerate the ad accounts and Pages they administer, so we can display analytics and recommendations. We never access assets the user has not granted."
- *ads_management:* "Used only to apply campaign/ad changes the user has explicitly approved in our UI. Every write is gated behind a per-action approval step shown to the user before execution; nothing is changed automatically."
- *pages_manage_posts / instagram_content_publish:* "Used only to publish a Page or Instagram post that the user reviewed and approved in Marpin. Each publish is triggered by an explicit per-action 'Approve & publish' click; Marpin never posts without that confirmation."
- *Screencast:* record a logged-in user connecting via the OAuth flow, viewing read metrics, then approving and triggering one write action (post + ad edit) showing the approval gate.

### 7. OAuth flow notes (don't break the impl)
- **No PKCE** (repo correct). CSRF = `state` only.
- Token exchange = credentials in **body** (client_id, client_secret, redirect_uri, code) — NOT Basic auth. Repo `tokenAuthStyle:'body'` correct.
- **No refresh_token.** Exchange the short-lived token (~1-2h) for a long-lived (~60d) token server-side: `GET /v25.0/oauth/access_token?grant_type=fb_exchange_token&client_id=...&client_secret=...&fb_exchange_token=<token>`. After 60d the user must re-auth — build re-consent UX.
- Pass the SAME `redirect_uri` in authorize and token calls or the exchange 400s.
- Pin every call to `/v25.0/`. **v25.0 is confirmed the latest, live, non-deprecated version (released Feb 18, 2026, expiration TBD)** — no bump needed now; bump `META_GRAPH_VERSION` when v26.0 ships and v25.0 nears its eventual sunset.
- Enable/handle `appsecret_proof` if "Require proof of app secret" is on (App settings → Advanced).

> ⚠️ Verify: if the app uses Facebook Login for Business, the authorize call may require a `config_id` and the scope handling differs — registry.ts's classic-style authorize URL may need adjustment.

### 8. Blockers / ETA
Business Verification (~5–15 business days) → App Review per permission (days-to-weeks; +1–4 weeks per rejected screencast round). Budget **~3–6 weeks** end-to-end for full read+write Advanced Access — this is the longest-pole connector; start Business Verification now.

Sources: [Marketing API Auth](https://developers.facebook.com/docs/marketing-api/get-started/authentication/) · [Permissions](https://developers.facebook.com/docs/permissions/) · [Facebook Login for Business](https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business) · [Instagram Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/) · [Strict URI Matching](https://developers.facebook.com/blog/post/2017/12/18/strict-uri-matching/) · [Long-Lived Tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/) · [App Modes](https://developers.facebook.com/docs/development/build-and-test/app-modes/) · [Graph API Versions](https://developers.facebook.com/docs/graph-api/changelog/versions/) · [Marketing API Access Tier rename](https://developers.meta.com/blog/updates-to-ads-management-standard-access-feature/)

> **Verification:** confidence 🟡 medium. Re-confirm at implementation time:
> - The exact authorize-URL behavior for Facebook Login for Business (whether config_id is strictly MANDATORY for a new Business app, vs config_id being optional and the classic scope param still accepted) could not be confirmed byte-for-byte from a single authoritative page — it depends on the specific app's login product. The repo's classic authorize URL in registry.ts may or may not need a config_id; this must be checked against the live App Dashboard for the actual Marpin app.
> - Whether the redirect-URI registration pane for FLB is labeled identically to classic Facebook Login in the current 2026 console UI — Meta changes dashboard labels frequently and this should be confirmed visually in the live console.
> - Exact Business Verification ETA varies widely (5–15 business days cited generally; can be longer for restricted verticals/peak periods). The 2–5 bd figure in the original is likely too low but a precise current SLA is not published authoritatively.
> - Whether ads_read specifically can obtain limited Standard/Limited-tier read on a user's own accounts WITHOUT Business Verification (likely yes for the connecting user's own assets) vs the OTHER-user case (needs Advanced + verification) — the distinction is well-supported but the precise per-permission matrix in the live App Review > Permissions and Features UI (which permission shows a 'Request Advanced Access' button gated on verification) should be confirmed in-console.
> - Whether pages_show_list / instagram_basic are strictly required additions for the enumerate-and-publish flow depends on the actual MetaAdsClient implementation, which was not deep-read here — flagged as a likely gap, not a verified missing scope.

---

## LinkedIn Ads (linkedin_ads)

**Console:** https://www.linkedin.com/developers/apps
**Authoritative docs used (verified June 2026 against the li-lms-2026-06 default moniker):**
- OAuth flow: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
- Programmatic refresh tokens: https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens
- Permissions/scopes (Key Concepts table): https://learn.microsoft.com/en-us/linkedin/marketing/getting-started + .../increasing-access
- Access tiers: https://learn.microsoft.com/en-us/linkedin/marketing/integrations/marketing-tiers
- Quick start / apply: https://learn.microsoft.com/en-us/linkedin/marketing/quick-start
- Community Mgmt overview + closed-scope FAQ: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview
- Community Mgmt app review: https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review
- App↔Page verification: https://www.linkedin.com/help/linkedin/answer/a548360

### Scope reality check (repo vs. current LinkedIn identifiers)
- READ `r_ads`, `r_ads_reporting` — **MATCH** current identifiers exactly (Key Concepts permissions table). `r_ads` = read ad accounts the member has a role on (ACCOUNT_BILLING_ADMIN / ACCOUNT_MANAGER / CAMPAIGN_MANAGER / CREATIVE_MANAGER / VIEWER); `r_ads_reporting` = pull reporting/analytics. Granted by the **Advertising API** product.
- WRITE `w_organization_social` — **MATCH** current identifier (Community Management API). Posts/comments/likes on behalf of an **organization (Company Page)**. Restricted to members holding ADMINISTRATOR / DIRECT_SPONSORED_CONTENT_POSTER / LEAD_GEN_FORMS_MANAGER on the Page (matches the doc verbatim).
- WRITE `w_member_social` — identifier is valid, **but the program that grants it (Member Post Management / Profile Management) is CLOSED.** Community Management overview FAQ #6: "r_member_social is a closed permission. We're not accepting access requests at this time due to resource constraints." **Loud flag: Marpin cannot obtain member-profile posting today.** Phase 1 "post to the user's own profile" must be descoped to org-Page posting (w_organization_social) until LinkedIn reopens member posting.

> ⚠️ Verify: The live repo registry (`src/lib/connectors/registry.ts`, ~line 148) currently lists `scopes: ["r_ads","r_ads_reporting"]` only — the two write scopes are described in `docs/connector-setup-brief.md` but are NOT in the registry. So Marpin's OAuth client today requests read-only scopes. Add `w_organization_social` to the registry only after the Community Management product is approved (adding a scope invalidates all existing user tokens).

### Step 1 — Prereqs (do these first or every product application is auto-rejected)
1. Create/own a **Marpin LinkedIn Company Page** (https://www.linkedin.com/help/linkedin/answer/a543852). Community Management APIs are "only available to **registered legal organizations** for commercial use cases" (app-review "Before You Submit"); have Marpin's legal name, registered address, website (marpin.ai), and privacy-policy URL ready.
2. Use a **verified business email on the marpin.ai domain** for the developer account — the doc explicitly states "Personal email addresses won't pass the vetting process."

### Step 2 — Create the app
1. Go to https://www.linkedin.com/developers/apps > **Create app**.
2. App name: `Marpin`. LinkedIn Page: select the Marpin Company Page. Upload the Marpin logo (shown on the OAuth consent screen). Accept terms > **Create app**. Do NOT put "Linked"/"In"/LinkedIn or Microsoft marks in the name or logo (explicit rejection criterion).

### Step 3 — Verify the app against the Page (gating prerequisite)
1. App > **Settings** tab > **Verify** > **Generate URL** > **Copy URL**.
2. Send it to a **super admin** of the Marpin Company Page; they open it and approve. App-to-Page verification by a same-org Page super admin is an explicit Development-tier review criterion — until verified, no Community Management product can be approved.

> ⚠️ Verify: The "30-day window" for the verification link is not stated in the current app-review doc — treat it as an operational detail to confirm in the console, not a documented value.

### Step 4 — Register redirect URIs (exact menu path)
App > **Auth** tab > **OAuth 2.0 settings** > **Authorized redirect URLs for your app** > **Add redirect URL**. Add:
- `https://www.marpin.ai/api/connect/linkedin_ads/callback`
- (local dev) `http://localhost:3000/api/connect/linkedin_ads/callback`
Rules (from the OAuth doc): URLs must be **absolute**, query **parameters are ignored**, the URL **cannot contain a `#`** fragment, and the runtime `redirect_uri` must **exactly match** a registered URL (mismatch → `401 Redirect_uri doesn't match`). The doc instructs adding the callback URL "via HTTPS" and all its examples are https.

> ⚠️ Verify: The doc does not explicitly say `http://localhost` is rejected — that is a caution, not a documented rule. http/localhost may be disallowed; for local dev prefer the Developer Portal Token Generator or an https tunnel.

### Step 5 — Copy credentials
App > **Auth** tab > **Application credentials**: copy **Client ID** → `LINKEDIN_CLIENT_ID`, reveal+copy **Primary Client Secret** → `LINKEDIN_CLIENT_SECRET`. Secret is server-side only.

### Step 6 — Apply for products (READ)
App > **Products** tab > find **Advertising API** > **Request access** > complete the access form. This is a **vetted** product (access reserved for supported use cases, not self-serve): describe Marpin as an AI marketing OS that reads campaign metrics/reporting for advertiser accounts the user administers, with explicit user consent per connection. After approval, the Auth tab lists `r_ads` and `r_ads_reporting` as available scopes. (Default = **Development tier**: unlimited GET/reporting on accounts the member administers; create limited to 1 test account, edit limited to 5 accounts. For read-only Marpin, Development tier is sufficient. Standard tier is only needed for bulk write/create — and note its upgrade itself requires a video demonstrating campaign create/edit/optimize, so it is not relevant to read-only Marpin.)

> ⚠️ Verify: ETA "~3-10 business days" is an **unverified estimate** — LinkedIn publishes no review SLA for the Advertising API. Plan for an indeterminate review window and possible rejection on use-case grounds.

### Step 7 — Apply for products (org WRITE — Community Management API)
App > **Products** tab > **Community Management API** > **Request access** → **Development Tier** form. Reviewed for: approved use case, verified business email, verified organization, verified org website/domain, and app verified by the same-org Page (all four are explicit Development-tier criteria in community-management-app-review). After Development approval, a **Standard Tier** form appears under My Apps > Products; Standard is what you need for real org-posting volume (**Dev tier limits, confirmed by FAQ #3: 500 req/app, 100 req/member**). Standard requires a **downloadable, narration-recommended screencast** plus working **test credentials** demonstrating, for a Page-Management use case: (a) a user completing the full OAuth consent, (b) the user posting to their LinkedIn Page via Marpin, (c) a member's comment on that post shown in Marpin, (d) what profile fields of the commenter Marpin displays. (Note: if your app has no access to other API products, request Community Management Dev tier on a fresh app per FAQ #1/#4 — the option is grayed out otherwise.)

> ⚠️ Verify: ETAs "Dev ~5-15 business days; Standard +2-6 weeks" are **unverified estimates** — not documented by LinkedIn. The directional claim (weeks, not days, end-to-end) is sound.

### Ready-to-paste answers (tailor lightly)
- **What does your application do?** "Marpin (https://www.marpin.ai) is an AI marketing operating system. Authenticated users connect their own LinkedIn advertiser accounts and Company Pages via OAuth. Marpin reads campaign reporting/analytics to give marketing recommendations, and — only after the user explicitly approves each individual action — publishes approved organic posts to the user's own Company Page on their behalf."
- **Which scopes and why?** "r_ads + r_ads_reporting: read the user's ad accounts and pull campaign reporting to surface performance insights. w_organization_social: publish user-approved organic content to Company Pages the user administers. Every write is gated behind a per-action human approval step in Marpin." (Do NOT request w_member_social — its program is closed.)
- **Who are your users / data handling?** "Business users (marketers, agencies, founders) managing their own brand. LinkedIn data is accessed under the connected user's token, stored encrypted, used only to render their own analytics and to execute their own approved actions, never resold or used to train models. Privacy policy: https://www.marpin.ai/privacy."
- **Per-action approval (call this out explicitly):** "Marpin never auto-posts. Each post is drafted, shown to the user, and published only on explicit click-to-approve."

### Extra credentials — Programmatic Refresh Tokens
- **Programmatic Refresh Tokens are partner-gated.** The OAuth doc says they are "available for a limited set of partners"; the dedicated page states the actual gate: "LinkedIn supports programmatic refresh tokens for all approved **Marketing Developer Platform (MDP) partners**." Eligibility therefore flows from **approved MDP partner status**, not from a self-serve form. Confirm whether the feature is enabled on the Marpin app (Auth tab / Developer Support). No fee documented.
- Without programmatic refresh: the standard refresh still works as a **seamless redirect** (the authorization screen is bypassed) as long as the member is still logged into linkedin.com and their current access token has not yet expired. Only when the access token has expired (or the member logged out) does the user hit the full consent screen again. So it is not a hard headless 60-day cycle, but it is not server-side/programmatic either.
- No developer-token / private-key concept exists for LinkedIn (unlike Google/Microsoft/Apple Ads) — Client ID + Secret is all.

### App review / verification summary
- **READ (r_ads, r_ads_reporting):** Required — Advertising API is vetted. Needs a Company Page, app↔Page verification, and a product application. **No paid tier / no fee.** ETA: not documented by LinkedIn (the prior "3-10 business days" was an unverified estimate).
- **Org WRITE (w_organization_social):** Required — Community Management Dev Tier (registered-legal-org + verified business email + verified org domain + verified-Page app), then Standard Tier (screencast + test creds) for real volume. **No fee, but the verification gates are hard.** ETA: not documented (prior day/week figures were estimates); plan for weeks end-to-end.
- **Member WRITE (w_member_social):** **Closed program — not currently grantable.** Descope member-profile posting from Phase 1.

### OAuth flow specifics (so Marpin's client doesn't break)
- authorize: `GET https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=...&redirect_uri=...&state=...&scope=<space-delimited,URL-encoded>`. No `code_challenge` — **PKCE is not part of this flow.**
- token: `POST https://www.linkedin.com/oauth/v2/accessToken` with `Content-Type: application/x-www-form-urlencoded` and body `grant_type=authorization_code&code=...&client_id=...&client_secret=...&redirect_uri=...`. **client_secret in the BODY, not HTTP Basic. No PKCE / no code_verifier.** A generic OAuth client defaulting to Basic-auth client credentials or sending a code_verifier will fail the exchange.
- Tokens: access_token = **60 days** (expires_in 5,184,000s); refresh_token (when the app is enabled for programmatic refresh) = **365 days**, returned with `refresh_token_expires_in`. Refreshing keeps the refresh token's original TTL and mints a fresh 60-day access token. Auth code = single-use, **30-min TTL**.
- API calls: `Authorization: Bearer <token>`, plus `LinkedIn-Version: YYYYMM` (use a current, non-sunset month — **202506/202505 are sunset; use e.g. 202606**; versions are supported ~12 months) and `X-Restli-Protocol-Version: 2.0.0` for versioned REST (ads reporting + posts).
- Changing the app's scope set invalidates all existing user tokens (the OAuth doc: changing scopes forces members to re-authenticate; requesting a different scope invalidates previously granted access tokens) — finalize scopes before launch.

> **Verification:** confidence 🟢 high. Re-confirm at implementation time:
> - All specific business-day ETAs in the runbook (READ ~3-10 days; Community Mgmt Dev ~5-15 days; Standard +2-6 weeks) are NOT documented by LinkedIn. LinkedIn publishes no review SLA. The directional 'weeks not days' framing is sound, but every exact day/week figure should be treated as an unverified author estimate.
> - The claim that an http://localhost redirect URI is 'commonly rejected' is the author's caution, not a documented rule. The OAuth doc only says URLs must be absolute, HTTPS is referenced in its add-callback instruction and all examples are https, params are ignored, and no '#'. Whether http/localhost is actually blocked must be confirmed empirically in the console.
> - The '30-day window' for the app-Page verification link is not stated in the current community-management-app-review doc; treat as an operational detail to confirm, not a documented value.
> - Programmatic refresh request mechanism: the runbook says to file a Developer Support ticket referencing a 'Programmatic Refresh Tokens program.' The docs instead gate the feature on approved Marketing Developer Platform (MDP) partner status with no documented self-serve request form. Whether a support ticket can actually trigger enablement for a non-MDP-partner app is unconfirmed.
> - Repo fidelity: the runbook reviews a stated scope set including the two write scopes, but the actual live registry (src/lib/connectors/registry.ts ~line 148) only contains ['r_ads','r_ads_reporting']. The write scopes exist only in docs/connector-setup-brief.md. This is a repo-vs-runbook discrepancy worth surfacing to the author.
> - Minor: the Advertising API Standard-tier upgrade also requires a campaign create/edit/optimize video (quick-start Step 2), which the runbook omits. Not material because Marpin is read-only on ads and stays on Development tier, but the runbook's implication that only Community Management Standard is screencast-gated is incomplete.

---

## TikTok Ads (tiktok_ads)

**Console (read / ads):** https://business-api.tiktok.com/portal/  → **My Apps**
**Console (write / video.publish):** https://developers.tiktok.com/ → **Manage apps** (this is a SEPARATE app — see step 6)
**Env vars:** `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`

> ⚠️ **Architecture flag (read this first).** TikTok splits Marpin's needs across **two different developer consoles and two different apps**:
> - **Ads read** = TikTok **Marketing API** on `business-api.tiktok.com` → `app_id` + `secret` (= `TIKTOK_APP_ID` / `TIKTOK_APP_SECRET`). Non-standard portal auth, JSON `{app_id,secret,auth_code}` token exchange, `Access-Token` header. This is what the repo's `oauthStyle:"tiktok"` is wired for. ✅ matches repo.
> - **Posting (`video.publish`)** = **Content Posting API** on `developers.tiktok.com` → `client_key` + `client_secret`, **standard OAuth v2** at `open.tiktokapis.com`. Different app, different creds, different code path. The repo's tiktok OAuth helper does **not** serve this — you'll need a second credential pair + the standard OAuth path. *(Confirmed: these are separate registration surfaces; a Marketing-portal `app_id` can never serve `video.publish`.)*
>
> ⚠️ **Verify: is `video.publish` even the right surface for Marpin?** `video.publish` (Content Posting API, Direct Post) posts **organic** content to a **creator/user** account authorized via **Login Kit** — it is **NOT** how you publish paid/ad creative to an **advertiser-owned** account. Publishing ad creative is a **Marketing API ad-creation flow** (upload creative → create ad / set advertiser identity; **Spark Ads** to amplify organic posts authorized via Business Center). Decide which "posting approved content" Marpin actually means: organic-to-creator-profile → `video.publish`; ads/advertiser-account → Marketing API ad creation (this section's Part B does **not** cover that).
>
> The repo's READ scopes `["(ads read — portal-granted, non-standard OAuth)"]` are **correct** — the Marketing API has no OAuth scope strings; permissions are portal "permission tiles" (Ads Management, Reporting, Creative Management). No mismatch to fix on read. The WRITE scope `video.publish` is real (confirmed current in TikTok's Scopes Reference) but lives on the *other* app.

### A. Create the Marketing API app (ads read — the repo's `tiktok_ads`)
1. Go to **https://business-api.tiktok.com/portal/** and sign in with the TikTok for Business account that owns Marpin's developer org. (Register as a developer if prompted; have a TikTok Business Center.)
2. **My Apps → Create an App.** Fill: **App name** (Marpin), **App description** (explain it reads advertiser metrics and executes user-approved actions), **Advertiser Redirect URL**, **Website URL**, **Privacy Policy URL**, **Terms of Service URL**.
3. **Redirect URI — where exactly:** in the app's **Basic Information / App Settings**, the field is **"Advertiser Redirect URL"** (a.k.a. Redirect URL). Register:
   - `https://www.marpin.ai/api/connect/tiktok_ads/callback`
   > ⚠️ Verify: `http://localhost:3000/...` is **likely rejected** for this web-app flow. TikTok requires **https** for web-application redirect URIs; plain `http://localhost` is permitted only for **desktop-application** URIs (host `localhost`/`127.0.0.1` **with a required port**), and 2026 developer reports confirm plain `http://localhost` does **not** work. For local testing use an **https tunnel (ngrok)** or a Sandbox test setup, not `http://localhost:3000`.
   Rules: **exact-match**, **static (no query params or fragments)**, **HTTPS-only** for web, **max 10 URIs**, each **<512 chars**.
4. **Permissions/Scopes — where exactly:** in the app's **Scope of Permission** section, enable the tiles **Ads Management** and **Reporting** (add **Creative Management** if Marpin will read/upload creatives). These are **tiles, not OAuth scope strings** — confirms repo's placeholder. Do **not** over-request (slows review).
5. **Credentials — where exactly:** **Basic Information** shows **App ID** → `TIKTOK_APP_ID`, and **Secret** (click to reveal/copy) → `TIKTOK_APP_SECRET`. Copy the secret immediately.

### B. Create the Content Posting app (write — `video.publish`)  *(only if Marpin posts ORGANIC content to a creator's own profile — for ads, use the Marketing API ad-creation flow instead)*
6. Go to **https://developers.tiktok.com/** → profile icon → **Manage apps → Connect an app** → pick the org owner.
7. **App details:** name, description, **redirect URI** (registered under the **Login Kit** product's redirect settings; HTTPS-only for web, exact-match), **Privacy Policy URL**, **Terms URL**. Verify URL ownership via **Manage URL properties** on the Manage Apps page.
8. **Products → Add products:** add **Login Kit** (for user auth) and **Content Posting API**, then request the **`video.publish`** scope. *(Also request **`user.info.basic`** — needed to read open_id/avatar/display name for the mandatory creator-info display. Consider **`video.upload`** (draft-to-inbox) as a lower-friction alternative that sidesteps Direct-Post audit strictness but requires the user to finish posting in-app.)*
9. **Credentials:** **App details → Credentials** shows **Client key** + **Client secret** — store these as a **separate** pair (do not overwrite `TIKTOK_APP_ID/SECRET`; add e.g. `TIKTOK_CONTENT_CLIENT_KEY/SECRET` when you wire posting).

### C. Review / audit / gates
- **Marketing API (read):** new apps start in **Sandbox** (instant, test-only). To read real third-party advertiser accounts you must **submit for production review** + pass a **data-security/compliance check**. Status flow: **Draft → In review → Live** (Recall to withdraw). **ETA: a few business days up to ~1-2 weeks** (official guidance: up to ~7 business days; the optimistic 2-3 days is a best case). Each customer must also grant your app access to their advertiser accounts in **their** Business Center.
- **Content Posting API (`video.publish`):** requires a **separate app audit** (developers.tiktok.com → **content-posting-api**). **Until audited, every post is forced to `SELF_ONLY` / private**, AND the app may only have **up to 5 users authorize/post within any 24h window** — public posting is impossible. Audit requires: a **working demo video** of the full OAuth + upload/publish flow, **privacy policy URL**, **verified URL ownership**, a clear data-handling description, proof the app **displays the creator's username + avatar before posting** (hard, verified requirement; pull from Query Creator Info), and a **privacy-level selector** plus **duet/stitch/comment controls** in the posting UX. **ETA ~2-6 weeks (typically 2-4, multiple feedback rounds; a clean first pass can be ~1-2 weeks but do not plan on it).**
- **Hard gates:** (1) two separate apps/credential pairs; (2) Marketing API production review + data-security check; (3) per-customer Business Center grant; (4) Content Posting app audit (SELF_ONLY + 5-users/24h until passed); (5) per-user Login Kit authorization for posting; (6) creator-info display + privacy/interaction-controls UX; (7) **business / URL-ownership verification** on both. **No per-call price and no paid tier on either API** (confirmed free to apply for); volume scales after audit.

### D. Review-form answers (paste-ready, tailored to Marpin)
- **What does your app do?** "Marpin (marpin.ai) is an AI marketing operating system. Authenticated customers connect their own TikTok advertiser and creator accounts. Marpin reads campaign metrics (Reporting) to generate insights and, only with explicit per-action human approval, creates/publishes marketing content on the user's behalf."
- **Which scopes/permissions and why?** "Marketing API permission tiles: Ads Management + Reporting to read the customer's own campaign and performance data; Creative Management to read/manage their creatives. Content Posting API: `video.publish` (+ `user.info.basic`) to publish **organic** content the customer has explicitly approved, one action at a time. (Paid ad creative is created via the Marketing API ad-creation flow, not `video.publish`.)"
- **How is user data handled?** "Per-tenant isolation, tokens encrypted at rest in a secrets vault, used only to serve that customer's dashboard and approved actions; not shared or sold; deletable on disconnect."
- **Posting UX:** "Before any post, Marpin calls Query Creator Info and shows the creator's username and avatar, plus a privacy-level selector and duet/stitch/comment controls; nothing is published without explicit in-app approval."

### E. OAuth-flow gotchas (will break Marpin if missed)
- **Read (Marketing API):** authorize at `https://business-api.tiktok.com/portal/auth?app_id=…&redirect_uri=…&state=…` (param is **`app_id`**, not client_id). Callback returns **`auth_code`** (not `code`). Token = **JSON POST** to `…/open_api/v1.3/oauth2/access_token/` with body `{app_id, secret, auth_code}` — **no Basic auth, no grant_type, no form-encoding**. API calls use the **`Access-Token`** custom header (not `Authorization: Bearer`). **No PKCE.** Version pinned **v1.3**. *(All confirmed against the repo's `oauthStyle:"tiktok"` wiring.)*
- **Redirect rules:** exact-match, static (no params/fragments on the registered URI), **https for web** (plain `http://localhost` not supported for web — use an https tunnel for local dev), max 10 / <512 chars.
- **Tokens:** advertiser access tokens on this surface are long-lived (do **not** assume the 24h creator-token/refresh loop from developers.tiktok.com).
- **Write (Content Posting):** different endpoints — authorize via Login Kit, token at `https://open.tiktokapis.com/v2/oauth/token/` with `client_key`/`client_secret`, **standard OAuth v2** (access_token ~24h, refresh_token ~1yr). Do **not** reuse the `oauthStyle:"tiktok"` helper for this. Direct Post endpoint `/v2/post/publish/video/init/`; draft/inbox alternative `/v2/post/publish/inbox/video/init/`. Version pinned **v2**.

> **Verification:** confidence 🟡 medium. Re-confirm at implementation time:
> - The official Marketing API portal docs (business-api.tiktok.com/portal/docs) are JavaScript-gated and could not be fetched directly; the auth-flow specifics (app_id param, auth_code callback, JSON token exchange, Access-Token header, v1.3) are confirmed via the repo's own wiring + multiple secondary sources and TikTok's authorization FAQ, but not re-read verbatim from the rendered official portal page.
> - The exact 'Advertiser Redirect URL' field label may render slightly differently in the current console (some sources show just 'Redirect URL'); behavior (exact-match, https, max 10, <512, static) is consistent across sources.
> - Whether http://localhost:3000 is accepted in the *Marketing API* sandbox specifically: documented http-localhost allowance is for DESKTOP-application URIs (with a required port) and developer reports say plain http localhost fails for web flows; I could not find a current official statement that the Marketing API sandbox whitelists http://localhost:3000 for a web app, so I downgraded it to 'verify / likely rejected' rather than confirming or hard-refuting.
> - Content Posting audit ETA varies widely by source (2-4 vs 2-6 weeks; 1-2 weeks best case); I widened to a 2-6 week range. The precise current SLA is not published by TikTok.
> - The runbook's phrase 'creator cap is set from your audit-form usage estimate' is plausible but I found only the documented hard cap (5 users/24h unaudited); the estimate-driven post-audit cap mechanism is not confirmed verbatim in official docs.
> - Whether Marpin's actual product intent for 'posting approved content' is organic-to-creator (video.publish) or ad creative (Marketing API ad creation) is a product question I cannot resolve from the runbook alone — flagged inline because it changes which surface/Part B applies.

---

## Microsoft / Bing Ads (microsoft_ads)

**What this app is.** One Marpin-owned Azure AD (Entra ID) v2 multi-tenant app. Customers sign in with their own Microsoft account and consent to let Marpin manage their Microsoft Advertising accounts. Marpin reads metrics in Phase 1; write/campaign-management is technically available under the same scope but gated off in Marpin's app layer.

> ⚠️ Verify: The underlying API here is SOAP v13 (Bing Ads API). Microsoft has announced SOAP feature freeze on **2026-10-01** and full shutdown on **2027-01-31**; new integrations are directed to the REST API. Confirm whether Marpin should target REST instead of v13 SOAP before building deeper. (Source: Microsoft Learn migration notes, 2026.)

**Repo-authoritative values (do NOT change — build the console to match):**
- Authorize: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`
- Token: `https://login.microsoftonline.com/common/oauth2/v2.0/token`
- Scopes (read, Phase 1): `https://ads.microsoft.com/msads.manage` `offline_access`
  > ⚠️ Verify: Microsoft's **canonical** authorize example includes a third scope — `openid` — i.e. `openid offline_access https://ads.microsoft.com/msads.manage`. `openid` is not strictly required to get Microsoft Advertising access + a refresh token, but the repo's two-value set is NOT a byte-for-byte match to the documented example. Decide whether to add `openid` (enables an id_token / OIDC sign-in).
- Write scopes to request now: **NONE** (msads.manage already includes write; Phase 1 stays read-only via app gating)
- PKCE: **off** (allowed, but see gotchas — Microsoft now *recommends* PKCE even for confidential web apps)
- Token credential style: **client_secret in form body** (NOT Basic auth)
- Env vars: `MICROSOFT_ADS_CLIENT_ID`, `MICROSOFT_ADS_CLIENT_SECRET` (+ add `MICROSOFT_ADS_DEVELOPER_TOKEN` for live API calls)
- Redirect URIs to register (both):
  - `https://www.marpin.ai/api/connect/microsoft_ads/callback`
  - `http://localhost:3000/api/connect/microsoft_ads/callback`

### Scope check — verified against current docs
The single scope `https://ads.microsoft.com/msads.manage` is the **current and only** Microsoft Advertising scope (confirmed on Microsoft Learn, consent guide updated 2026-06-05). **Critical caveat (CONFIRMED):** there is no read-only Microsoft Advertising scope — `msads.manage` grants full read **and** write. Per Microsoft, the developer token "does not grant additional permissions"; effective access is governed by the connected user's Microsoft Advertising **role** (Super Admin vs Advertiser Campaign Manager, etc.), not by the OAuth scope. So Marpin's "read-only in Phase 1" must be enforced **in code (capability gating)** and/or by connecting users with a read-limited Microsoft Advertising role — never by a narrower scope. `offline_access` is required to receive a refresh token.

> ⚠️ Verify: The documented authorize example also includes `openid` (full string: `openid offline_access https://ads.microsoft.com/msads.manage`). Confirm whether Marpin's authorize request should include it.

### Step 1 — Register the Azure app (instant)
1. Go to **https://portal.azure.com** → search **App registrations** (or use Microsoft's direct link: https://go.microsoft.com/fwlink/?linkid=2083908). Sign in with a **Work or School account** — per Microsoft, "You can no longer log in using a personal Microsoft account." (CONFIRMED, register doc updated 2026-06-05.)
2. Click **New registration**.
3. **Name:** `Marpin` (shown on the consent screen to end users).
4. **Supported account types:** choose the **multitenant + personal accounts** option. Microsoft's Bing Ads doc labels this **"Any Entra ID Tenant + Personal Microsoft accounts"**.
   > ⚠️ Verify: The exact UI string drifts between the Azure portal and the Bing docs. The Azure portal itself may render this as **"Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts"**. Pick the radio option that means *multitenant + personal* regardless of exact wording; don't pattern-match on a single literal string.
5. Leave Redirect URI blank for now → click **Register**.
6. On the **Overview** page, copy **Application (client) ID** → this is `MICROSOFT_ADS_CLIENT_ID`.

### Step 2 — Add redirect URIs (Authentication blade)
1. Left nav → **Manage → Authentication**.
2. Click **Add a platform → Web** (must be **Web**, not SPA/native — Marpin is a confidential web app that stores a secret). Microsoft explicitly notes apps spanning regions/devices (e.g. Azure/Vercel) "should register a web application with client secret" so the refresh token works across devices.
3. Under **Redirect URIs**, add BOTH, exactly:
   - `https://www.marpin.ai/api/connect/microsoft_ads/callback`
   - `http://localhost:3000/api/connect/microsoft_ads/callback`
4. Save. Per the consent doc, redirect_uri "must exactly match one of the redirect_uris you registered in the portal, except it must be url encoded." https is required for prod; http is allowed only for localhost.

### Step 3 — Create the client secret (Certificates & secrets)
1. Left nav → **Manage → Certificates & secrets**.
2. **Client secrets** tab → **New client secret**.
3. Description: `marpin-prod`. Expires: pick a duration (e.g. 24 months) and put a rotation reminder on the calendar.
4. Click **Add**, then **immediately copy the secret VALUE** (the "Value" column, not the "Secret ID"). It is shown only once → this is `MICROSOFT_ADS_CLIENT_SECRET`.

> Use a certificate instead of a secret? Optional and not needed — a client secret is fully supported and is what the repo expects (secret in the token body). Stick with the secret.

### Step 4 — API permissions (usually automatic)
The `msads.manage` permission is exposed by the **Microsoft Advertising API Service** service principal. Consent is requested dynamically via the `scope` parameter at authorize time, so for the OAuth flow you generally do **not** need to manually add it under **API permissions**. If you want it pinned: **Manage → API permissions → Add a permission → APIs my organization uses → search "Microsoft Advertising" → Delegated permissions → msads.manage → Add**.

> ⚠️ Verify: The exact "added automatically once a Microsoft Advertising account is signed in with a work account" mechanism is not spelled out verbatim in Microsoft's docs; the documented failure path is the per-tenant AADSTS650052 case below (the Microsoft Advertising service principal `d42ffc93-c136-491d-b4fd-6f18168c68fd` may be absent from a customer tenant and need adding). Treat the "usually automatic" claim as practical guidance, not a documented guarantee.

### Step 5 — Get the Microsoft Advertising Developer Token (separate credential — required for live API)
OAuth alone does not let you call the Bing Ads API. Every SOAP request also needs a Developer Token in the `DeveloperToken` header (alongside `CustomerId` and `CustomerAccountId`).
1. Ensure Marpin has a Microsoft Advertising account (https://ads.microsoft.com/). Sign in as **Super Admin**.
2. Go to the Developer Portal: **`https://developers.ads.microsoft.com/Account`** (account tab) — this is the URL Microsoft's step-by-step still uses. Microsoft also notes: "Starting May 31, 2025, the Developer Portal page will be deprecated and replaced with a new version" at **`https://ads.microsoft.com/cc/Settings/DevSettings`**. Use whichever is live; the DevSettings URL is the forward-looking canonical page.
3. Choose the user to associate, click **Request Token** → you get the **universal** developer token (works for all customers your app serves). Save it as `MICROSOFT_ADS_DEVELOPER_TOKEN`.
   - **Sandbox:** universal sandbox dev token is `BBD37VB98` (CONFIRMED, get-started doc) — test against https://sandbox.bingads.microsoft.com/ with separate creds; good for wiring the flow before the prod token lands.
   > ⚠️ Verify (ETA): Microsoft's official docs describe only clicking **Request Token** and give **no published SLA**. The "instant for first-party / up to ~5 business days for a tool-provider/third-party review" figure comes from third-party blogs, **not** Microsoft documentation. As a multi-tenant SaaS, Marpin may be routed through review, but treat the 5-business-day number as unverified — confirm at request time.
   > ⚠️ Verify (cost): The "free / no paid tier exists" claim is plausibly true historically but is **not stated** in the current FAQ or get-started docs reviewed. Do not present it as a verified current fact without checking Microsoft Advertising's pricing/support page.

### App review / verification
**No Azure app-store review, no Microsoft business verification, no verified-Page requirement, and no separate write-scope review form** — write is bundled into `msads.manage`, so there is nothing to elevate beyond connecting a user with sufficient Microsoft Advertising role. The only credential gate is the developer-token request above. ETA to a usable Azure app + secret: minutes.
> ⚠️ Verify: The developer-token ETA ("instant-to-5-business-days") and the "no paid/elevated tier exists" claim are NOT confirmed by current official docs (see Step 5 flags). Re-confirm both at request time rather than asserting them.

### Per-customer onboarding gotcha (document for end users)
Some customer Entra tenants will fail the first consent with **AADSTS650052** because the Microsoft Advertising service principal (`appId d42ffc93-c136-491d-b4fd-6f18168c68fd`) isn't present in their tenant. Fix (CONFIRMED in Microsoft docs): their AD admin adds it via Graph — `POST https://graph.microsoft.com/v1.0/servicePrincipals` with `{"appId":"d42ffc93-c136-491d-b4fd-6f18168c68fd"}` — and grants admin consent (Microsoft documents an `/adminconsent` URL with `scope=...msads.manage` for this). Surface a clear error + instructions in Marpin's connect flow for org/work-account users.

### OAuth flow gotchas (so Marpin's implementation doesn't break)
- **PKCE off works, but Microsoft now recommends PKCE for confidential web apps too.** The consent doc marks `code_challenge` as *recommended* (never *required*), and explicitly adds it "is now recommended for all application types - native apps, SPAs, and confidential clients like web apps." Repo's `usesPkce:false` is allowed, but consider enabling PKCE to match Microsoft's current recommendation.
- **Secret in body, not Basic** — send `client_secret` (url-encoded) in the `application/x-www-form-urlencoded` token body. Repo's `tokenAuthStyle:'body'` is correct.
- **offline_access** — required in the `scope` to get a refresh token. Repo includes it. (Microsoft's canonical example also includes `openid` — see scope flag above.)
- **common tenant** — keep `/common/` in both URLs so any work/personal account can connect. Microsoft recommends `common` for Bing Ads auth. Repo does.
- **Web app + secret** (not public/native) so the refresh token works across Vercel regions/devices — Microsoft explicitly calls this out.
- **Exact redirect match** including trailing path and url-encoding.
- **Tokens:** access ~1h (Microsoft: "typically expires after one hour"); refresh long-lived (~90 days for public clients per FAQ) but revocable anytime → handle `invalid_grant` by re-consenting.
- **API surface is SOAP/XML** (Campaign Management, Reporting, Customer Management v13) and every call needs `DeveloperToken` + `CustomerId` + `CustomerAccountId` headers in addition to the OAuth bearer token.
  > ⚠️ Verify: v13 SOAP is on a deprecation clock (feature freeze 2026-10-01, shutdown 2027-01-31). Confirm whether to target the REST API for new build.

### Sources
- Register an application: https://learn.microsoft.com/en-us/advertising/guides/authentication-oauth-register?view=bingads-13 (updated 2026-06-05)
- Request user consent: https://learn.microsoft.com/en-us/advertising/guides/authentication-oauth-consent?view=bingads-13 (updated 2026-06-05)
- Get access and refresh tokens: https://learn.microsoft.com/en-us/advertising/guides/authentication-oauth-get-tokens?view=bingads-13
- Get started / developer token: https://learn.microsoft.com/en-us/advertising/guides/get-started?view=bingads-13 (updated 2026-06-05)
- FAQ (requirements, msads.manage, token expiry): https://learn.microsoft.com/en-us/advertising/guides/faq?view=bingads-13 (updated 2026-06-05)

> **Verification:** confidence 🟢 high. Re-confirm at implementation time:
> - Developer-token review SLA: the '~5 business days for tool-provider/third-party requests' is NOT in any current official Microsoft doc (get-started gives no SLA at all). It comes only from third-party blogs (beaconry.app, unified.to). Unverified — confirm at request time.
> - Cost claim: 'free / no paid tier exists for the Microsoft Advertising API' is not stated in the current FAQ or get-started pages I reviewed. Historically true but not currently sourced — do not assert without checking Microsoft Advertising pricing/support.
> - Scope exactness: Microsoft's canonical authorize example is 'openid offline_access https://ads.microsoft.com/msads.manage' — the repo omits 'openid'. Not strictly required for MS Advertising access, but the runbook's 'exact repo match' claim is slightly inaccurate.
> - 'Supported account types' label: the Bing doc says 'Any Entra ID Tenant + Personal Microsoft accounts', which differs from the longer Azure-portal string the runbook quotes. Same option, but exact UI wording drifts between portal redesigns.
> - 'API permissions added automatically once a Microsoft Advertising account is signed in with a work account' is practical lore, not a documented Microsoft guarantee; the documented reality is the per-tenant AADSTS650052 service-principal gap.
> - SOAP v13 deprecation: feature freeze 2026-10-01, full shutdown 2027-01-31. The runbook builds against v13 SOAP; whether Marpin should target the REST API instead is a strategic gap worth confirming (dates surfaced via search summarizing Microsoft migration notes; verify exact dates on the official migration guide).

---

## Amazon Ads (amazon_ads)

Marpin connects each customer's own Amazon Ads account through ONE Login with Amazon (LWA) developer app. Two independent things must both be done, and the second is the slow one:

1. **Create the LWA security profile** (instant) — gives you the Client ID / Secret and where redirect URIs live.
2. **Get Amazon Ads API access** (review, days→weeks) — a separate Advanced Tools Center request that attaches the `advertising::campaign_management` scope to the LWA app via "Assign API access". Without step 2 the OAuth call only ever returns profile scopes and Ads calls 401.

> ⚠️ Verify: As a third-party **Tool Provider** (Marpin's category), plan for **several weeks**, not days. Current guidance shows Direct Advertiser applications clear in ~2–3 business days while Tool Provider applications "can take several weeks" and get a deeper business-model/policy review.

### Repo-authoritative values (do not change)
- Platform key: `amazon_ads`
- Authorize URL: `https://www.amazon.com/ap/oa`
- Token URL: `https://api.amazon.com/auth/o2/token` (NA host)
- READ scope: `advertising::campaign_management` (double colon — verified current; matches repo `src/lib/connectors/registry.ts`)
- WRITE scopes: NONE in Phase 1 (read-only by Marpin policy — see warning below)
- PKCE: false (correct for a confidential server client)
- Env vars: `AMAZON_ADS_CLIENT_ID`, `AMAZON_ADS_CLIENT_SECRET`
- Redirect URIs to register:
  - `https://www.marpin.ai/api/connect/amazon_ads/callback`
  - `http://localhost:3000/api/connect/amazon_ads/callback`

> ⚠️ **There is no read-only Ads scope.** `advertising::campaign_management` grants full read AND write — Sponsored Products v3 / Sponsored Brands / Sponsored Display all expose create/update/delete (POST/PUT/DELETE) campaign endpoints under this exact scope (it is "the required scope for most requests to the Amazon Ads API"). "Phase 1 read-only" is enforced in Marpin's own code, not by the scope. There is therefore **nothing extra to request later for write** — when Marpin enables actions, no new scope or review is needed; only the per-action approval gate in Marpin changes.

### Step A — Create the LWA security profile (instant)
1. Go to **https://developer.amazon.com/loginwithamazon/console/site/lwa/overview.html** (sign in with the Amazon account that owns/will own the Ads access — use the SAME account in Step C).
2. Click **Create a New Security Profile**.
3. Fill in:
   - **Security Profile Name**: `Marpin`
   - **Description**: `Marpin — AI marketing OS connecting customers' Amazon Ads accounts.`
   - **Consent Privacy Notice URL**: `https://www.marpin.ai/privacy`
   - (optional) Consent logo, max 50px tall.
4. **Save**.

### Step B — Register redirect URIs + grab credentials (instant)
1. In the security-profile table, hover the gear in the **Manage** column and choose **Web Settings**, then **Edit**.
2. **Allowed Return URLs** — add BOTH, one per line, exactly:
   - `https://www.marpin.ai/api/connect/amazon_ads/callback`
   - `http://localhost:3000/api/connect/amazon_ads/callback`
   (Allowed Origins can be left blank — Marpin uses redirect flow, not the JS popup SDK.)
3. **Save**.
4. On the same Web Settings panel copy:
   - **Client ID** → `AMAZON_ADS_CLIENT_ID`
   - **Client Secret** (reveal it — the control is labeled **Show Secret** / on some console versions **Show Client ID and Client Secret**) → `AMAZON_ADS_CLIENT_SECRET`

> ⚠️ Verify: exact console label for revealing the secret drifts ("Show Secret" vs "Show Client ID and Client Secret") — check the live Web Settings panel.

Rules that bite: return URLs must be an EXACT match (protocol + host + path) to what Marpin sends as `redirect_uri`; production must be HTTPS; `localhost` over http is accepted for dev (LWA explicitly permits non-HTTPS localhost return URLs, with port, for development).

### Step C — Apply for Amazon Ads API access (the slow gate)
1. Go to **https://advertising.amazon.com/about-api**, sign in (SAME Amazon account as Step A), accept the Amazon Ads API license terms.
2. Open the **Advanced Tools Center** and complete **Apply for access** (`https://advertising.amazon.com/API/docs/en-us/guides/onboarding/apply-for-access`). You categorize your organization:
   - **Advertiser** — automating your own advertising accounts (approval typically ~2–3 business days), OR
   - **Third-party / integration (tool) provider** — building software that manages advertising on behalf of other advertisers and licensing it to them (approval typically **several weeks**, with a deeper review of whether the business model fits Amazon's API terms). **Marpin is a third-party tool provider** (customers connect their own accounts).

> ⚠️ Verify: a tool provider may need to register via the Amazon Ads **Partner Network**. Confirm the current registration path in the live Advanced Tools Center before applying.

3. **App-review form answers (paste-ready, tailored to Marpin):**
   - *Company / product*: `Marpin (https://www.marpin.ai)`
   - *What does your application do?*: `Marpin is an AI marketing operating system. Customers authenticate their own Amazon Ads account via Login with Amazon and grant Marpin read access to their advertising data. Marpin retrieves campaign, ad group, keyword and reporting metrics to give the advertiser AI-generated analysis and recommendations.`
   - *How will you use the API / which programs?*: `Reporting and campaign-management read endpoints for Sponsored Products, Sponsored Brands and Sponsored Display via the v3 API, plus /v2/profiles to list the advertiser's profiles.`
   - *Will you create or modify campaigns (write)?*: `Not in the initial release. Future write actions (create/update campaigns, budgets, creatives) will be executed only after explicit, per-action human approval by the advertiser inside Marpin.`
   - *Who are your users?*: `The advertisers themselves and their agencies; each connects only their own Amazon Ads account through OAuth.`
   - *Data handling*: `Tokens are stored encrypted at rest; metrics are used only to serve that advertiser; no resale of raw Amazon data.`
4. Submit. Amazon does **not** publish a review SLA. For Marpin (tool provider), plan for **several weeks** (community reports range from a couple of days for direct advertisers to multiple weeks for tool providers). If it stalls, email **ads-api-onboarding@amazon.com** referencing your application.

> ⚠️ Verify: prerequisite reality — applying effectively requires an Amazon Ads advertising entity. Direct-advertiser approval expects active advertising/campaign history, and `/v2/profiles` only returns once at least one advertising account/profile exists. An Amazon login with no advertising account attached generally cannot obtain a usable campaign-management grant.

### Step D — Assign API access to the LWA app (required, easy to miss)
Once approved, in the **Advanced Tools Center → Assign API access** (`https://advertising.amazon.com/API/docs/en-us/guides/onboarding/assign-api-access`): select the LWA security profile from Step A so the **`advertising::campaign_management`** scope is bound to it. This is the ONLY way that scope becomes available — the LWA console itself only offers profile scopes. Confirm in the Developer dashboard that your app now lists `advertising::campaign_management` (you may also see `advertising::test:create_account`). Must be done with the SAME Amazon login used in Step C — an account mismatch here is a documented top cause of "Unknown scope"/401.

### Hard gates checklist
- ✅ Accept Amazon Ads API license terms.
- ✅ An Amazon Ads **advertising account** (third-party tool providers register as such, likely via the Partner Network; an individual with no ads account generally cannot get campaign-management scope).
- ✅ **Ads API access request approved** (separate allowlist — the real gate; weeks for a tool provider).
- ✅ **Assign API access** completed so the scope binds to the LWA app (same Amazon login as the application).
- ❌ No paid/elevated tier or fee for the API itself. ❌ No separate write-scope review. ❌ No Page-admin / Business-Manager linkage step.

### OAuth-flow gotchas (must match for Marpin to work)
- **Scope grant path**: `advertising::campaign_management` comes from Step D, not the LWA console. Skipping Step D → OAuth returns only profile scopes → Ads calls 401.
- **Scope string**: double colon `advertising::campaign_management`. Single colon silently fails / "Unknown scope". (Repo correct.)
- **PKCE**: optional for a confidential server client — `usesPkce:false` is correct. PKCE is mandatory only for public/browser clients, which then would NOT receive a refresh token.
- **Refresh token**: returned automatically because Marpin exchanges the code server-side with `client_secret`. Do **not** send `access_type=offline` (no such param on LWA).
- **Token credential transport**: body params `client_id`/`client_secret` (Marpin's default) OR HTTP Basic both work — no override needed.
- **redirect_uri exact match** between the authorize call and the token call, and against Allowed Return URLs; HTTPS for prod.
- **Regional hosts**: auth is pinned to NA (`api.amazon.com`; EU `api.amazon.co.uk`, FE `api.amazon.co.jp` exist for those regions). Data calls must hit the region of the advertiser's profile (`advertising-api.amazon.com` NA / `advertising-api-eu.amazon.com` / `advertising-api-fe.amazon.com`).
- **Per-call headers** (separate from OAuth scope): every Ads API request needs `Amazon-Advertising-API-ClientId: <AMAZON_ADS_CLIENT_ID>` and `Amazon-Advertising-API-Scope: <profileId>` (the chosen advertiser profile from `/v2/profiles`). Missing ClientId header is a common 401.

**Doc sources:** LWA console/registration & redirect URLs — developer.amazon.com/docs/login-with-amazon/register-web.html; Authorization Code Grant (authorize params, token host, refresh, PKCE) — developer.amazon.com/docs/login-with-amazon/authorization-code-grant.html; Ads API authorization/scope — advertising.amazon.com/API/docs/en-us/guides/account-management/authorization/{overview,authorization-grants}; Ads API onboarding/apply/assign — advertising.amazon.com/API/docs/en-us/guides/onboarding/{overview,apply-for-access,assign-api-access}; no-fee + categories — advertising.amazon.com/about-api; onboarding failure modes — github.com/amzn/ads-advanced-tools-docs/discussions/161; write endpoints — advertising.amazon.com/API/docs/en-us/sponsored-products/3-0/openapi/prod.

> **Verification:** confidence 🟢 high. Re-confirm at implementation time:
> - Approval ETA: Amazon publishes no formal SLA. The 2–3 business days (advertiser) vs several weeks (tool provider) figures come from a reputable secondary source (Unified.to) and community reports, not an Amazon SLA page. Marpin's tool-provider path should be assumed to be weeks; treat any single number as an estimate.
> - Exact console label for revealing the client secret drifts ('Show Secret' vs 'Show Client ID and Client Secret') — verify against the live Web Settings panel.
> - Whether a tool provider must specifically register through the Amazon Ads Partner Network (vs only the Advanced Tools Center application) could not be pinned to a single current canonical page — the Ads SPA docs are JavaScript-rendered and were not directly extractable; confirm the live flow.
> - The exact prerequisite that an applicant must already have an advertising entity is strongly implied by current guidance (profiles only return once an account exists; advertiser approval expects campaign history) but Amazon does not state a hard, single-sentence 'you must have an ad account' rule — verify against the live apply-for-access page.
> - The official advertising.amazon.com OpenAPI/onboarding pages render client-side, so direct OpenAPI scope-per-endpoint text could not be machine-extracted; the write-under-this-scope conclusion rests on the authorization overview ('required scope for most requests', covers SP/SB/SD) plus consistent secondary specs rather than a quoted per-endpoint scope line.

---

## Pinterest Ads (pinterest_ads)

**Status in repo:** read-only Phase 1. Scope `ads:read`, no PKCE, token endpoint uses HTTP Basic auth. Env vars `PINTEREST_APP_ID` / `PINTEREST_APP_SECRET`. Repo values verified correct against Pinterest's current v5 docs — `ads:read`, Basic-auth token endpoint, and no-PKCE all match.

### 0. The one thing that matters most
For Marpin's multi-tenant model, **Standard access is effectively mandatory for production** — plan for it from day one. The API itself is **free**: there is no paid or elevated tier and no per-call fee (verified June 2026; ad-platform pricing can change, so re-confirm at implementation).

> ⚠️ Verify: The exact reason Trial is insufficient is NOT confirmed by official docs. The runbook previously claimed "Trial only lets the app OWNER and explicitly-added test accounts complete OAuth; non-owner accounts cannot authorize until Standard." That specific mechanism is **unverified and likely overstated.** Pinterest's official docs describe Trial as "Sandbox" access — limited **data visibility** (Pins/boards visible only to their creator) and **blocked writes** (POST returns 403), not a documented block on *who can complete the OAuth consent screen*. Third-party sources state the opposite of the old framing ("the same OAuth client can authorize many users"; "test users can authenticate via OAuth during Trial"). Net: Standard is still the right target for production multi-tenant, but confirm the precise Trial-vs-Standard authorization/data boundary in the live portal before committing the GTM timeline.

### 1. Prerequisites
- A Pinterest **business account** (personal accounts can't reach the developer portal). Convert or create one at business.pinterest.com and verify the account email.
- Accept the **Developer Terms of Service** on first visit to the apps dashboard.
- A reachable **privacy policy URL** (needed for the Standard upgrade / app profile) — use https://www.marpin.ai/privacy.

### 2. Create the app
1. Go to **https://developers.pinterest.com/apps/** ("My apps").
2. Click **Connect app**.
3. Fill the application request form (app name "Marpin", description: an AI marketing OS that reads ad metrics and, with explicit per-action user approval, posts approved content on the user's behalf; include the privacy-policy URL).
4. Submit. This requests **Trial access**. Reviewed each business day — expect approval email in **~1 business day**.

### 3. Get credentials
Once approved, return to **My apps** -> open the app. The **App ID** and **App secret** are shown in the app details.
- `PINTEREST_APP_ID` = **App ID**
- `PINTEREST_APP_SECRET` = **App secret** (copy now, store in vault; regenerate from this page if leaked)

### 4. Register redirect URIs (exact path)
My apps -> **Manage** on the app -> **Configure** tab -> scroll to **Redirect URIs** -> enter each URI -> click **Add** -> save. Register BOTH, exactly:
```
https://www.marpin.ai/api/connect/pinterest_ads/callback
http://localhost:3000/api/connect/pinterest_ads/callback
```
The `redirect_uri` sent on the authorize call and the token call must match a registered value **byte-for-byte** (scheme, host, path, trailing slash). Official rule: *"The value given for redirect_uri during OAuth authorization will be matched against the redirect URIs listed in your app profile. They must be an exact match to avoid any exceptions."* Additionally: **the redirect URI must not cause the server to send a secondary redirect to yet another URI** — point it straight at the callback handler.

### 5. Scopes
Pinterest does NOT have a per-app scope checkbox UI — scopes are requested at runtime on the authorize URL. The registry already sends the correct, current identifier:
- **`ads:read`** — read access to advertising data. ✅ Matches `registry.ts` exactly. (Confirmed against Pinterest's current v5 scope list.)

No write scopes in Phase 1. For reference, when Phase 2 needs writes, the v5 scopes are distinct:
- **`ads:write`** — write access to advertising/ad-object data (campaigns, ad groups, ads). This does NOT post content.
- **`pins:write`** — create/update/delete Pins. This is the **content-posting** scope.

Both write scopes are blocked on Trial (POST returns 403) and require **Standard access plus a fresh demo that shows the actual write action**. Re-verify the exact write-scope set against the live v5 docs before any Phase-2 write work.

### 6. Standard access upgrade (the required review)
Needed for production / non-owner customer accounts to connect with full functionality. Prerequisites: app already approved for Trial, compliant with Developer Guidelines, working privacy-policy URL.

**Submit a screen-recording video demo** that shows:
1. The full **OAuth consent flow** — a user being sent through https://www.pinterest.com/oauth/ and granting `ads:read`.
2. A real **Pinterest API call** running (the demo may be Postman/terminal, but the OAuth flow MUST be visible).

**Ready-to-paste answers for the use-case form:**
- *What does your app do?* — "Marpin (https://www.marpin.ai) is an AI marketing operating system. Customers sign in and connect their own Pinterest Ads account via OAuth. Marpin reads their advertising metrics (ads:read) to generate analytics and recommendations. Any content-posting or ad-creation action is executed only after explicit, per-action human approval by the account owner."
- *Which scopes and why?* — "ads:read only. We read ad account, campaign, and ad performance metrics to power reporting and AI-generated recommendations. We request no write scopes."
- *How is user data stored / handled?* — "OAuth tokens are stored encrypted in a secrets vault, scoped per user. We do not store Pinterest credentials. We do not sell or share user data. Privacy policy: https://www.marpin.ai/privacy."
- *Privacy policy URL:* https://www.marpin.ai/privacy

**Common rejection reasons to avoid:** OAuth flow not shown in the video; vague app description; broken/inaccurate privacy policy.

> ⚠️ Verify: **ETA is directional only, not an official SLA.** Community reports indicate ~1 week (≈5 business days) for a clean submission and 3–4 weeks if reviewers ask for changes. Pinterest publishes no committed turnaround. Use this for planning, not promises.

### 7. Hard gates summary
- Pinterest **business account** to create the app.
- Accept **Developer ToS**.
- **Trial -> Standard** upgrade required for production / non-owner customers (video demo + privacy policy).
- **No** separate business verification (unlike Meta), **no** paid/elevated tier, **no** separate API allowlist, **no** Page-admin gate.

### 8. OAuth-flow gotchas (implementation correctness)
- **PKCE: off.** `usesPkce:false` is correct — do not add a code_challenge.
- **Token endpoint uses HTTP Basic auth.** `POST https://api.pinterest.com/v5/oauth/token` with `Authorization: Basic base64(PINTEREST_APP_ID:PINTEREST_APP_SECRET)`. Credentials in the HEADER, not the body. `tokenAuthStyle:'basic'` is correct. (Confirmed: official example base64-encodes `client_id:client_secret`.)
- **Token body:** `grant_type=authorization_code`, `code`, `redirect_uri` (exact match). On **apps created before 2025-09-25**, also send **`continuous_refresh=true`** to get the modern refresh token. On apps created **on/after 2025-09-25** this parameter is a no-op (continuous refresh is automatic) — sending it is harmless but unnecessary.
- **Refresh tokens:** Use the **continuous refresh token** (60-day expiry, refreshable indefinitely). The legacy 365-day refresh token is **discontinued / no longer supported**. Refresh proactively before the 60-day window. (Confirmed against current auth docs.)
- **Access token lifetime:** 2,592,000s (30 days). Refresh proactively; don't wait for a 401.
- **Authorize URL** `https://www.pinterest.com/oauth/` params: `client_id`, `redirect_uri` (exact), `response_type=code`, `scope=ads:read`, `state` (CSRF). Multiple scopes may be space- or comma-separated (moot for a single scope).
- **Grant type:** Authorization Code only (returns per-user tokens). Do NOT use Client Credentials — it only yields an app-owned token, useless for customer accounts.
- **Trial rate cap:** universal 1,000 requests/day per app across all endpoints, plus stricter per-category caps — keep dev polling under this.
- **Redirect URIs:** must be pre-registered and matched exactly, with no secondary redirect; http://localhost is fine to register for dev, production callback is already HTTPS.

### Doc sources used
- developers.pinterest.com/docs/getting-started/connect-app/
- developers.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/
- developers.pinterest.com/docs/key-concepts/access-tiers/
- developers.pinterest.com/docs/api/v5/ (scope list)
- help.pinterest.com/en/business/article/granting-access-to-third-party-services

> **Verification:** confidence 🟡 medium. Re-confirm at implementation time:
> - CLAIM 2 (headline gate) is the biggest residual uncertainty. No current official Pinterest source confirms that non-owner/customer accounts are blocked from COMPLETING the OAuth consent flow on Trial access. Official docs only describe Trial as 'Sandbox' (limited data visibility + blocked writes/403). Multiple third-party sources actually state the opposite of the runbook's old framing ('the same OAuth client can authorize many users'; 'test users can authenticate via OAuth during Trial'). The practical takeaway (Standard is required for production multi-tenant) holds, but the stated mechanism does not. Confirm the exact owner-vs-customer authorization/data boundary live in the portal.
> - Standard-upgrade review ETA has no official SLA; '~1 week clean / 3-4 weeks with changes' is community-sourced and directional only. Section 0/Section 6 wording was internally inconsistent (~1 week vs ~5 business days); standardized but still unofficial.
> - continuous_refresh=true should be conditional, not unconditional. It only matters for apps created BEFORE 2025-09-25. The original 'MUST send or get no usable refresh token' phrasing applies only to pre-cutoff apps; for apps created on/after 2025-09-25 it is a no-op. Confirm which side of the cutoff Marpin's app falls on.
> - The official Pinterest doc pages are JS-rendered and several deep-link paths (e.g. /docs/api/v5/oauth-token/, /docs/getting-started/access-tiers/) returned 404 or nav-only content via WebFetch. Core OAuth/refresh/redirect facts were confirmed from the canonical set-up-authentication and connect-app pages plus the access-tiers page, but the Trial-authorization boundary specifically could not be pinned to an official page and rests on community/third-party reporting.
> - Whether a privacy-policy URL is a hard requirement at initial Trial app creation vs only at the Standard upgrade was not explicitly confirmed on the connect-app page (privacy policy is part of the app profile/Standard review); treat it as required for the Standard upgrade and recommended at creation.
> - The exact 'fresh demo' requirement wording for write scopes (ads:write / pins:write) at Phase 2 is inferred from the general Standard-upgrade demo rule plus community reports that the demo should show the representative write action; re-verify the specific demo expectations when scoping Phase-2 writes.

---

## Snapchat Ads (snapchat_ads)

**Status:** Open API — no app review, no allowlist, no demo video, no paid tier, and (per Snap's help center) no business verification. You can have working credentials in minutes by creating an OAuth App and accepting the terms. The one real friction is redirect-URI handling (see Gotchas).

> ⚠️ Verify: The authoritative developer pages (authentication / quick-start / FAQ) do NOT explicitly state the API is review-free — only Snap's business help center and third-party docs do. This is the most consequential claim for go-live and the one most likely to change. Re-confirm in-console (create an OAuth App; if it activates immediately with no application/approval step, the claim holds) before launch.

**Console:** Snap Business Manager → https://business.snapchat.com/ → **Business Details** → **OAuth Apps**
**Docs used:** https://developers.snap.com/api/marketing-api/Ads-API/authentication · https://developers.snap.com/marketing-api/Ads-API/quick-start · https://developers.snap.com/api/marketing-api/Ads-API/faq · https://businesshelp.snapchat.com/s/article/api-apply

### 0. Prereqs
- You must be an **Organization Admin** in the Snap org that will own the app (the OAuth Apps dashboard is invisible otherwise). This is a one-time requirement for *Marpin's* operator, not for end customers. ✅ Confirmed by docs.
- You must accept the **Snap Developer Terms** and **Snap Business Tools Terms** the first time you create an app. ✅ Confirmed.

### 1. Create the OAuth app (prod)
1. Log in to **Ads Manager** at https://ads.snapchat.com/ (or https://business.snapchat.com/).
2. Top-left menu → **Business Dashboard** → **Business Details**.
3. Scroll to **OAuth Apps** → click **+ OAuth App** (accept the terms prompt the first time).
4. Fill in:
   - **Name:** `Marpin`
   - **Redirect URI:** `https://www.marpin.ai/api/connect/snapchat_ads/callback`
     (must match exactly at token time — no trailing slash; Snap docs say the redirect "should be a SSL hosted URL you control.")
5. Click **Create**.
6. The page now shows **Client ID** and **Client Secret**.
   - **Copy the Client Secret NOW** — it is shown only once and can never be re-displayed (only regenerated). Regenerating the secret is expected to invalidate tokens issued against the old secret. > ⚠️ Verify: token-invalidation-on-secret-regeneration is asserted by secondary sources but is NOT stated in Snap's official developer docs — don't rely on it as a documented guarantee.
   - Set: `SNAPCHAT_CLIENT_ID = <client id>`, `SNAPCHAT_CLIENT_SECRET = <client secret>`.

### 2. Handle the second redirect URI (localhost) — IMPORTANT
A Snapchat OAuth app accepts **only one redirect_uri**, and **it cannot be edited** after creation (Snap's FAQ: you "cannot edit an existing redirect_uri instead you will need to set up a new app"). ✅ Confirmed. The repo registers two callbacks:
- `https://www.marpin.ai/api/connect/snapchat_ads/callback`
- `http://localhost:3000/api/connect/snapchat_ads/callback`

You therefore **cannot put both on one app**. Pick one of:
- **(A) Two apps:** Create a *second* OAuth app with redirect `http://localhost:3000/api/connect/snapchat_ads/callback`, and use its own client id/secret for local dev (e.g. `SNAPCHAT_CLIENT_ID`/`SNAPCHAT_CLIENT_SECRET` in `.env.local`). **Caveat:** Snap docs say the redirect should be SSL-hosted; a plain `http://localhost` URI **may be rejected at creation**. > ⚠️ Verify: no current official source confirms localhost/http is actually rejected by the creation form — it "should" be SSL but the hard rule is unconfirmed. If it is rejected →
- **(B) https tunnel (recommended default):** Run local dev behind an https tunnel (ngrok/Cloudflared) or a deployed Vercel preview, register that https URL as the dev app's redirect, and skip the literal localhost URI. Prefer this path since the SSL guidance is explicit and the localhost-acceptance behavior is unverified.

Production only needs the prod app from step 1.

### 3. Scope
- The **only** scope Marpin requests is `snapchat-marketing-api` — this matches `registry.ts` exactly (`scopes: ["snapchat-marketing-api"]`). ✅ No mismatch.
- This single scope grants **read AND write** (Snap's auth doc: it "allows the app to read and write to the Snapchat marketing APIs"). There is no separate read scope, no separate write scope, and no write-tier review. Phase-1 read-only is enforced in Marpin's code, not by Snapchat — the issued token is technically write-capable. ✅ Confirmed.
- (FYI only — not used by Marpin: `snapchat-offline-conversions-api` for CAPI, `snapchat-profile-api` for public-profile reads/posting.)

### 4. OAuth flow (matches the repo)
- **Authorize:** `https://accounts.snapchat.com/login/oauth2/authorize?response_type=code&client_id=<id>&redirect_uri=<exact>&scope=snapchat-marketing-api&state=<csrf>` ✅
- **Token / refresh:** POST `https://accounts.snapchat.com/login/oauth2/access_token`
  - Auth-code: `grant_type=authorization_code`, `code`, `client_id`, `client_secret`, `redirect_uri` — **all in the form body**. ✅
  - Refresh: `grant_type=refresh_token`, `refresh_token`, `client_id`, `client_secret` — **and do NOT send `redirect_uri`**. (CORRECTED: the official authentication-doc refresh curl omits `redirect_uri`; only the auth-code exchange requires it.)
- **PKCE:** none (`usesPkce:false` correct). ✅
- **Credential style:** **body params, NOT Basic auth** (do not set `tokenAuthStyle:'basic'`). ✅ Confirmed against the doc's curl examples and the registry.
- **Tokens:** access token = 3600s (60 min). ✅ The refresh token "does not expire, but will cease to function if the user it is tied to has their access removed" (per Snap's FAQ). Note: per the FAQ, adding/removing individual ad accounts is reflected WITHOUT generating new tokens. > ⚠️ Verify: the runbook's extra death-triggers — losing a specific ad-account role, or secret regeneration — are not stated in Snap's official docs; the only documented trigger is the tied user's access being removed.

### 5. Review / approval — NONE (re-verify)
- The Marketing API is described as **open to every developer** with no app review, allowlist, demo video, business verification, Trial→Standard tiering, developer token, or separate write-capability review. A connecting customer authorizes via the standard OAuth consent screen; the token only grants what **that user's** ad-account role allows, so the customer must have at least viewer access to the ad account Marpin should read. No extra Marpin-side review form exists.
- > ⚠️ Verify: This "no review / instant" status is stated by Snap's help center and third-party integrators but is NOT restated on the authoritative developer pages. Re-confirm by actually creating an OAuth App before relying on "instant" for go-live.
- **ETA: instant (subject to the verification above).**

### 6. Extra credential applications
- **None.** No developer token, no private key, no Team/Key ID, no separate API onboarding. Client ID + Secret from the OAuth app is the complete credential set. ✅ Confirmed.

### Riskiest things to re-verify before launch
1. Whether a single OAuth app can hold more than one redirect_uri — today: **no**, and it is not editable → two apps (or one app + https tunnel) needed. ✅ Confirmed.
2. Whether `http://localhost` is accepted as a redirect — Snap says it "should be SSL hosted"; literal-localhost acceptance is **unconfirmed**, so prefer an https tunnel/preview. ⚠️
3. That the Marketing API is still review-free/open for both read and write — confirmed by secondary/help-center sources but **silent in the primary developer docs**; re-check in-console at launch. ⚠️
4. That the token refresh request omits `redirect_uri` and sends only refresh_token/client_id/client_secret/grant_type. ✅ (corrected in §4).

> **Verification:** confidence 🟡 medium. Re-confirm at implementation time:
> - Whether http://localhost (non-SSL) is actually rejected by the OAuth-App creation form. Snap docs say the redirect 'should be a SSL hosted URL,' but no current official source explicitly states localhost/http is refused at creation. Could not test in-console without an account. The runbook's 'may be rejected' hedge is appropriate; the https-tunnel path (option B) is the safe default.
> - Whether the Marketing API is genuinely review-free / no-business-verification TODAY. The authoritative developer pages (authentication, quick-start, FAQ) are completely silent on any access gate. The 'open to everyone' claim is sourced only from Snap's business help center (api-apply, which is JS-gated and did not render via fetch) and third-party integration docs. This is the highest-stakes claim for go-live; re-verify by creating an OAuth App in the console.
> - Whether regenerating the client secret invalidates existing refresh/access tokens. Asserted by secondary sources but NOT stated in Snap's official developer docs. Official FAQ only documents that the refresh token dies when the tied user's access is removed.
> - Whether losing a specific ad-account role (vs. the user's overall org access) kills the refresh token. The official FAQ documents only 'user's access removed' as the trigger, and explicitly says ad-account add/remove is reflected without new tokens — which partially contradicts the runbook's 'dies if the user loses org/ad-account access' phrasing.
> - The exact businesshelp.snapchat.com article text (api-apply / api-faq) could not be fetched — those pages are client-side rendered and returned a CSS/loading error to WebFetch. Findings for the 'open API' claim rely on Snap's developer FAQ plus search-surfaced summaries of the help-center articles rather than a direct quote from the rendered help-center page.

---

## Reddit Ads (reddit_ads)

**Platform key:** `reddit_ads` · **Console:** https://www.reddit.com/prefs/apps · **Flow:** OAuth 2.0 authorization-code, confidential client, **no PKCE** · **Token auth:** HTTP Basic

Marpin connects each customer's own Reddit advertiser account through ONE Marpin-owned Reddit app. Phase 1 is **read-only** (`adsread`, `read`). Repo registry (`src/lib/connectors/registry.ts` lines 190-202) is correct: `usesPkce:false`, `tokenAuthStyle:"basic"`, `extraAuthorizeParams:{duration:"permanent"}`, scopes `["adsread","read"]`, envs `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`.

> Heads-up before you start: Reddit registers **exactly one redirect URI per app**, and the **Ads API is allowlist/partner-gated** (no self-serve app-review flow, no published SLA). Both shape the steps below.

### 1. Create the app (instant, self-serve)
1. Sign in to Reddit as the Marpin service/brand account (not a personal throwaway — this account owns the credentials long-term).
2. Go to **https://www.reddit.com/prefs/apps**.
3. Scroll to the bottom and click **"are you a developer? create an app…"** (or **"create another app…"** if you already have one).
4. Fill the form:
   - **name:** `Marpin` (or `Marpin (prod)`)
   - **App type radio:** select **`web app`** (NOT script, NOT installed app — web app is the confidential redirect-based client Marpin needs).
   - **description:** `AI marketing OS that reads a user's Reddit Ads metrics on their behalf.`
   - **about url:** `https://www.marpin.ai`
   - **redirect uri:** `https://www.marpin.ai/api/connect/reddit_ads/callback`
5. Click **"create app"**.

### 2. Copy credentials
On the resulting app card:
- **REDDIT_CLIENT_ID** = the short unlabeled string shown **directly under the app name** (just below the words "web app"; format like `a1b2C3d4E5f6g7`).
- **REDDIT_CLIENT_SECRET** = the value labeled **`secret`**.

Paste both into Marpin's secret store. To reveal/rotate later, click **`edit`** on the app card.

### 3. Redirect URIs — the one-URI-per-app catch
The prefs/apps form has a **single** "redirect uri" textbox and enforces **exact match** at authorize time (official OAuth2 wiki: "If this does not match the registered redirect_uri, the authorization request will fail"). You cannot register both of Marpin's URIs on one app. Choose one:
- **Recommended:** create **two apps** — a **prod** app with redirect `https://www.marpin.ai/api/connect/reddit_ads/callback`, and a **dev** app with `http://localhost:3000/api/connect/reddit_ads/callback` (http is acceptable for localhost dev only; production must be https). Wire prod creds to prod env, dev creds to local `.env`.
- Or run prod-only and skip the localhost flow.

Register exactly:
- `https://www.marpin.ai/api/connect/reddit_ads/callback` (prod app)
- `http://localhost:3000/api/connect/reddit_ads/callback` (dev app)

> ⚠️ Verify: Reddit's wiki shows localhost being used for dev and exact-match enforcement, but does not state a verbatim "https-only except localhost" policy. The https-for-prod / http-for-localhost split is the standard OAuth norm; confirm Reddit accepts your exact prod https URI at registration.

### 4. Scopes (confirm against live authorize)
Reddit's OAuth2 wiki documents scopes as a **space-separated** list, and notes **commas are also supported** — so `adsread,read` works, but space-separated is the documented primary form. Marpin Phase-1 read set:
- **`adsread`** — view Ads campaigns, ad groups, ads, and reporting (the read-only Ads scope; lists ad accounts/campaigns/ad groups/ads + performance reports). ✅ matches repo.
- **`read`** — Reddit Data API read (posts/subreddits) for organic context. ✅ matches repo.

⚠️ Scope-drift check: Reddit's full current Ads scope set is `adsread`, `adsedit` (create/update campaigns, ad groups, ads, audiences), `adsconversions`, and `history`, plus Data API `read`. Phase 1 deliberately requests **none** of the write scopes. If you ever add posting/creation, you'll add `adsedit` here — but see review note below.

Authorize URL Marpin must build (comma-separated scopes work; the wiki's primary form is space-separated):
```
https://www.reddit.com/api/v1/authorize?client_id=REDDIT_CLIENT_ID&response_type=code&state=CSRF&redirect_uri=<exact registered uri>&duration=permanent&scope=adsread,read
```
Token exchange:
```
POST https://www.reddit.com/api/v1/access_token
Authorization: Basic base64(REDDIT_CLIENT_ID:REDDIT_CLIENT_SECRET)
Content-Type: application/x-www-form-urlencoded
grant_type=authorization_code&code=CODE&redirect_uri=<same exact uri>
```

> ⚠️ Verify: Re-confirm the exact scope IDs against the live authorize screen before launch — Reddit could rename/split Ads scopes, and the canonical scope reference (oauth.reddit.com/api/v1/scopes) is the authoritative source.

### 5. Access review / allowlist — the real gate
Reddit has **no Meta/Google-style app-review with screencasts**. Instead:
- **READ by a connected advertiser:** the OAuth app is live immediately, but **Ads API endpoints (`ads-api.reddit.com/api/v3`) return 403 until the advertiser's account is allowlisted** for the Ads API. 403s also occur if the token lacks the right Ads scopes or the authorizing user lacks the right role on the target `account_id`. The connecting advertiser typically navigates allowlisting with Reddit directly (via their Reddit ads rep), and/or Marpin onboards as an official **Ads API partner** so its app can serve many advertisers.
- **WRITE (`adsedit`) — out of scope for Phase 1.** A write API exists (v3 campaign/ad-group endpoints), but full campaign-management access is the most tightly allowlisted tier (typically requires admin role on the account plus partner approval) and, from **July 13 2026**, ad-group/CBO creation **requires a `conversion_pixel_id`**. Do not request `adsedit` until Phase 2 and partner approval are in hand.

**How to request partner/allowlist access:** email **adsapi-partner-support@reddit.com** describing: who Marpin is, the integration, scopes used, that actions are **explicitly user-approved per-action**, and expected request volume. Managed advertisers can also request via their Reddit Ads account rep. Agree to the **Reddit Ads API Terms**.

> ⚠️ Verify: The Reddit Ads API Terms article (business.reddithelp.com / advertising.reddithelp.com) is 403-gated to logged-out fetches and could not be confirmed directly. Read it while signed in before accepting, and confirm whether the END ADVERTISER (not just Marpin) must be separately allowlisted for your read endpoints.

**Ready-to-paste partner-onboarding email:**
> Subject: Ads API partner onboarding — Marpin (AI marketing OS)
>
> We operate Marpin (https://www.marpin.ai), an AI marketing operating system. Our customers connect their own Reddit Ads accounts to Marpin via OAuth 2.0 through our single registered web app. In Phase 1 we are strictly **read-only** — we request the `adsread` and `read` scopes to surface each customer's campaign metrics and reporting inside their dashboard. We do not write or modify any campaign in Phase 1. Any future write capability (e.g. `adsedit`) will execute only on **explicit, per-action human approval** by the account owner.
> - Use case: read campaign/ad-group/ad performance + reporting for the connecting advertiser's own account.
> - Scopes (Phase 1): `adsread`, `read`. Refresh tokens via `duration=permanent`.
> - Multi-tenant: each customer authorizes their own account; we never share data across tenants.
> - Expected volume: [fill in QPM estimate].
> Please advise on allowlisting our app/customers for Ads API read access and any onboarding steps. We accept the Reddit Ads API Terms.

**Hard gates:** (a) end-advertiser ad account + admin role on the target `account_id`; (b) account-level **Ads API allowlist** approval (informal, case-by-case, no SLA); (c) possibly Marpin onboarding as an **Ads API partner**; (d) acceptance of the **Reddit Ads API Terms**; (e) for the plain Data API `read` at multi-tenant scale, Reddit's **commercial Data API pricing** likely applies — the free ~100 QPM cap is **per OAuth client (shared across all Marpin users)** and the free tier is non-commercial-only, so a multi-tenant SaaS likely needs a negotiated commercial contract.

> ⚠️ Verify (pricing — CORRECTED): The 2026 commercial Data API tier is reported at **~$12,000 per MONTH for up to ~50M calls (≈$144k/year)**, with **~$0.24 per 1,000 calls** overage — NOT "~$12k/yr." Reddit publishes no rate card; the figure comes from third-party 2026 breakdowns and is set by negotiated contract after a ~2–4 week use-case review. Get a quote from Reddit enterprise sales before assuming any number.

**ETA:** App creation — **instant**. Ads API allowlist/partner onboarding — **no published SLA, realistically several business days to multiple weeks** (~2–4 week review window cited for commercial Data API access), dependent on advertiser status and partner relationship; can stall without a Reddit ads contact.

### 6. OAuth-flow gotchas (will break the implementation if missed)
- **No PKCE** — confidential web app, classic code flow only.
- **HTTP Basic auth at the token endpoint** — `Authorization: Basic base64(client_id:client_secret)` (wiki: the 'user' is the `client_id`, the 'password' is the `client_secret`); never put creds in the body.
- **`duration=permanent` is mandatory** to get a `refresh_token`; without it, access tokens expire in ~1h with no refresh.
- **Scopes accept commas, but the documented primary form is space-separated** — `adsread,read` works (wiki: "Commas are supported too"), just don't assume comma is the *only* accepted delimiter.
- **Redirect URI exact match**, **one per app**, **https for production** (http allowed for `localhost` dev only).
- **No Test/Live mode** — app is live on creation; Ads endpoints simply 403 until allowlisted (or until scopes/role are correct).
- **Mandatory User-Agent** on all API calls: `web:marpin:1.0 (by /u/<marpin account>)`; generic/missing UA causes aggressive 429s. (Reddit Data API enforces this strongly; treat as required.)
- **Rate limit is per `client_id`** (~100 req/min, 10-min avg) shared across all tenants — design for shared-budget throttling; monitor `X-Ratelimit-Used` / `-Remaining` / `-Reset` headers.
- **Two API surfaces:** Data API `oauth.reddit.com` (scope `read`) vs Ads API `ads-api.reddit.com/api/v3` (scope `adsread`) — different hosts, different access gates. Pin the Ads API to **v3**.

**Docs verified (2026):** Reddit OAuth2 spec (github.com/reddit-archive/reddit/wiki/OAuth2) — Basic auth, duration=permanent → refresh_token, exact-match redirect, scopes space-separated (commas also supported); Reddit Ads API auth/scope walkthroughs (unified.to, stitchflow.com, redaccs.com) — web-app type, scope IDs `adsread/adsedit/adsconversions/history/read`, allowlist process, `adsapi-partner-support@reddit.com`, July 13 2026 `conversion_pixel_id` mandate, `ads-api.reddit.com/api/v3`; Reddit Data API pricing (octolens.com, techloy.com — 2026) — free 100 QPM/OAuth-client non-commercial cap, commercial tier **~$12k/month** for ~50M calls + ~$0.24/1k overage. The 403-gated official help/terms articles (business.reddithelp.com) could not be fetched directly — cross-checked against the above; re-verify scope IDs against the live authorize screen and read the Ads API Terms while signed in before launch.

> **Verification:** confidence 🟡 medium. Re-confirm at implementation time:
> - Pricing precision: the '~$12k/month for ~50M calls + ~$0.24/1k overage' figure comes from third-party 2026 breakdowns (octolens, techloy), not an official Reddit rate card — Reddit does not publish pricing and negotiates per contract. The direction (monthly five-figure, NOT annual) is well-corroborated, but the exact number should be treated as indicative and confirmed with Reddit enterprise sales.
> - Whether multi-tenant Data API 'read' is definitively classified as commercial: free tier is documented as 'no commercial use allowed' and per-OAuth-client, which strongly implies a SaaS needs a contract, but Reddit's enforcement threshold for a low-volume multi-tenant app is not explicitly documented.
> - Reddit Ads API Terms page (business.reddithelp.com / advertising.reddithelp.com) returned HTTP 403 to logged-out fetches — its exact acceptance requirements and whether the END ADVERTISER must be separately allowlisted (vs only the developer) could not be confirmed from primary source; must be read while signed in.
> - The 'https-only except localhost' redirect rule is a standard OAuth convention and shown in Reddit dev examples, but Reddit's own OAuth2 wiki does not state it verbatim; confirm the exact prod https URI is accepted at registration.
> - Exact scope identifiers (adsread/adsedit/adsconversions/history/read) are confirmed across multiple 2026 third-party guides but the canonical oauth.reddit.com/api/v1/scopes reference was not fetched directly; re-confirm against the live authorize screen at launch.
> - Mandatory User-Agent format and the precise per-client rate-limit numbers (~100 req/min) are well-established for the Data API; their exact applicability to the Ads API host is described as 'similar ballparks' rather than officially pinned.

---

## Apple Search Ads (apple_search_ads)

> **Read this first — this is NOT redirect OAuth.** Apple Search Ads (Apple Ads) uses **OAuth 2 client_credentials with a self-signed ES256 JWT** as the `client_secret`. There is **no authorize URL, no browser redirect, and no callback URI.** The two redirect URIs in the connector brief (`https://www.marpin.ai/api/connect/apple_search_ads/callback` and the localhost one) **do not apply and cannot be registered anywhere** — Apple has no field for them. The repo is already correct on `authorizeUrl: ""` and `usesPkce: false`. **One repo bug to fix:** `scopes: []` must become `scopes: ["searchadsorg"]` — the token request fails without it (verified verbatim in Apple's official OAuth PDF and developer docs, 2026).

> ⚠️ Verify (registry bug): the actual value in `src/lib/connectors/registry.ts` (line 236) is `scopes: []` (empty array), NOT `["searchadsorg","searchadsorg"]`. The correct fix is exactly `["searchadsorg"]` — a **single** element. Do not duplicate it.

> ⚠️ Verify (deprecation — MISSING from the original section): Apple has announced that the **entire Campaign Management API sunsets January 26, 2027** and is replaced by the new **Apple Ads Platform API** (preview docs released ~April 2026; general availability Summer 2026, also covering Apple Maps ads). v5 is the current version but is on a fixed end-of-life clock. Treat this connector as a migration target, not a long-term integration. (Sources: 9to5mac 2026-04-02; Apple help/campaigns API page.)

### What you actually set up
You create an EC P-256 keypair, paste the **public** key into the customer's Apple Ads account, and Apple returns `clientId` / `teamId` / `keyId`. Marpin signs a short-lived JWT with the **private** key and exchanges it for a 1-hour Bearer token. Every API call also needs an `X-AP-Context: orgId={orgId}` header.

### Step 0 — Customer grants Marpin access (per customer, required)
The customer's **Account Admin** signs in at https://ads.apple.com → **Account Settings → User Management → Invite User**, enters Marpin's API-user email/Apple ID, and assigns an API role:
- **API Account Read Only** — Phase 1 read-only (recommended for Phase 1).
- **API Account Manager** or **Limited Access API Read & Write** — needed later for write/execute actions.

The invitee accepts via the emailed link (must sign in with the same Apple ID). There is **no paid tier, no business verification, no app review** for this. (Confirmed against Apple's "Invite Users" and "Campaign Management API" help pages — no cost/verification gate is mentioned.)

### Step 1 — Generate the keypair (Marpin, once per key)
```
openssl ecparam -genkey -name prime256v1 -noout -out private-key.pem
openssl ec -in private-key.pem -pubout -out public-key.pem
```
Keep `private-key.pem` secret → this is `APPLE_SEARCH_ADS_PRIVATE_KEY` (store \n-escaped). You only ever upload `public-key.pem`.

### Step 2 — Create the API client (gets clientId/teamId/keyId)
1. Sign in to https://ads.apple.com as the invited API user.
2. Go to **Account Settings → API** tab.
3. Click **Create** (a client), paste the **full contents of `public-key.pem`** including the `-----BEGIN PUBLIC KEY-----` / `-----END PUBLIC KEY-----` lines, and **Save**.
4. Apple displays three values — copy each:
   - `clientId` → `APPLE_SEARCH_ADS_CLIENT_ID` (format `SEARCHADS.<uuid>`)
   - `teamId` → `APPLE_SEARCH_ADS_TEAM_ID`
   - `keyId` → `APPLE_SEARCH_ADS_KEY_ID`
   
   To rotate the key later: **Account Settings → API → Edit**.

> The old key-and-certificate authentication flow is **deprecated** (OAuth 2 replaced it) — ignore any third-party guide that mentions a `.pem`/`.key` certificate download. There is no scope picker; the only scope is `searchadsorg`, granted implicitly.

### Step 3 — Build the client_secret JWT (ES256) — verbatim from Apple
```
// Header
{ "alg": "ES256", "kid": "<keyId>" }
// Payload
{
  "sub": "<clientId>",                       // SEARCHADS.<uuid>
  "iss": "<teamId>",
  "aud": "https://appleid.apple.com",
  "iat": <now-unix>,
  "exp": <now-unix + 86400*180>              // MAX 180 days; do not exceed
}
```
Sign with the EC private key (P-256). Your JWT library must support `ES256`. (Confirmed verbatim in Apple's OAuth PDF: "expiration timestamp ... May not exceed 180 days from issue timestamp. expiration_timestamp = issued_at_timestamp + 86400*180".)

### Step 4 — Exchange for an access token
```
POST https://appleid.apple.com/auth/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=<clientId>
&client_secret=<the JWT from step 3>
&scope=searchadsorg
```
- Params are sent **form-urlencoded — NOT HTTP Basic auth.** (Apple's own example passes them in the query string with `Content-Type: application/x-www-form-urlencoded`; sending them in the request body is equally valid.)
- Response: `{ "access_token": "...", "token_type": "Bearer", "expires_in": 3600, "scope": "searchadsorg" }`.
- **No refresh token.** TTL is 3600s — cache ~55 min, then re-sign a fresh JWT and re-call this endpoint.

### Step 5 — Call the API (capture orgId)
Every request needs two headers:
```
Authorization: Bearer {access_token}
X-AP-Context: orgId={orgId}
```
Fetch the customer's `orgId` once via the **Get User ACL** endpoint after the first token, then persist it on the connection record. Base URL is `https://api.searchads.apple.com/api/v5/...` (current major). Pin the major version in the path; Apple deprecates old majors on a schedule.

> ⚠️ Verify: v5 is the **current** version, but the whole API (all versions, including the `/api/v4/` shown in Apple's own PDF examples) is **sunset 2027-01-26**. Plan the move to the Apple Ads Platform API.

### App review / verification
- **None for read or write.** No scope approval form, no business verification, no Page-admin gate, no paid/elevated tier. Access is governed entirely by the **API role the customer assigns** in Step 0. (Confirmed: no cost/verification gate appears in Apple's Campaign Management API or Invite Users help pages.)
- **Write exists today** (full campaign/ad-group/keyword CRUD via the Campaign Management API; current v5, v4 still present but older) and needs only an **API Account Manager** / **Limited Access API Read & Write** role — no extra Apple review and no paid write tier. Phase 1 stays read-only by Marpin's choice, not platform limitation; keep approval-gated execution in the app layer.

> ⚠️ Verify: write is genuinely available today, but it lives on the deprecating Campaign Management API (EOL 2027-01-26). Build any write/execute path with the migration to the Apple Ads Platform API in mind.

### Optional — third-party OAuth registration (only for brokered multi-org)
If Marpin wants one app to serve many customer orgs **without** a per-customer email invite, Apple requires registering a third-party OAuth 2 application: email **ads-registration@group.apple.com**. (Confirmed: Apple's docs explicitly direct third-party service providers to this address; terms and current process are not publicly documented.) No published SLA — budget **5–15 business days** for a reply, treated as an estimate only. Not needed for the per-customer invite model above.

### ETA
**Instant / minutes** for the self-serve path once the customer has assigned a role. The only human-in-the-loop delay is the customer accepting the invite (typically same day). Third-party brokered registration (if pursued) is the only multi-day gate, and its timeline is unpublished.

### Gotchas that will break the implementation
- **No redirect/callback** — do not wire an authorize URL or callback route for this connector.
- **scope=searchadsorg is mandatory** (fix `scopes: []` in `registry.ts` line 236 → `["searchadsorg"]`, single element).
- **client_secret is a self-signed ES256 JWT**, not a static string; `APPLE_SEARCH_ADS_PRIVATE_KEY` is the signer.
- **Token creds go form-urlencoded** (query or body) — not Basic auth.
- **`X-AP-Context: orgId={orgId}` required on every call**; capture orgId at onboarding via Get User ACL.
- **1-hour token, no refresh token** — re-mint by re-signing the JWT.
- **`clientId`=JWT `sub`, `teamId`=JWT `iss`, `keyId`=JWT `kid`** — swapping these yields `invalid_client` (the most common Apple-forum error).
- **JWT `exp` ≤ 180 days** from `iat`.
- **Deprecation clock:** Campaign Management API (all versions) sunsets **2027-01-26**; migrate to the Apple Ads Platform API (preview 2026, GA Summer 2026).

**Docs used:** https://developer.apple.com/documentation/apple_ads/implementing-oauth-for-the-apple-search-ads-api · https://developer.apple.com/documentation/apple_ads/calling-the-apple-search-ads-api · https://developer.apple.com/documentation/apple_ads/apple-search-ads-campaign-management-api-5 · https://ads.apple.com/app-store/help/campaigns/0022-use-the-campaign-management-api · https://ads.apple.com/app-store/help/get-started/0011-invite-users-to-your-account · OAuth PDF: https://ads.apple.com/adsdam/cn/zh_cn/documents/help/0022-use-the-campaign-management-api/Apple-Ads-OAuth-v1.pdf · sunset announcement: https://9to5mac.com/2026/04/02/apple-details-plan-to-sunset-ads-campaign-management-api-in-2027/

> **Verification:** confidence 🟢 high. Re-confirm at implementation time:
> - Repo registry value: the task prompt claims registry.ts has scopes: ["searchadsorg","searchadsorg"], but the actual file (src/lib/connectors/registry.ts line 236) has scopes: [] (empty). The author's runbook correctly describes it as scopes: []. The correct fix is ["searchadsorg"] (one element).
> - Form-urlencoded location: the runbook says params go in 'the body/query'. Apple's own PDF example actually sends them in the URL query string (with Content-Type application/x-www-form-urlencoded). Body-encoded is also accepted in practice. Either works; the load-bearing point (NOT Basic auth) is correct.
> - API version 'v4/v5': v5 is current and v4 still exists, so 'v4/v5' is not wrong, but the more material fact the runbook omits is that the WHOLE Campaign Management API sunsets 2027-01-26 in favor of the new Apple Ads Platform API (preview 2026, GA Summer 2026). Any new build should target the migration.
> - I could not render Apple's JS-heavy developer.apple.com pages via WebFetch (they returned only the page title). Confirmation of OAuth specifics comes from Apple's official OAuth PDF (extracted with pdftotext) plus WebSearch summaries of the Apple docs, which agree. The 180-day, scope, token_type/expires_in, no-refresh-token, and X-AP-Context facts are confirmed verbatim from the PDF.
> - Third-party registration SLA: the '5–15 business days' figure is an unverified estimate. Apple publishes no SLA for ads-registration@group.apple.com responses; only the email address and the existence of the process are confirmed.

---

_End of runbook. Regenerate by re-running the `marpin-connector-runbook` workflow._