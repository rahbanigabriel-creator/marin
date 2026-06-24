# Parallel session prompt — set up ALL Marpin connectors (read + write/app-review)

Paste the block below into a **new Claude Code session** (ideally with the Claude-in-Chrome extension connected, so it can drive the platform developer consoles). It runs in parallel with the action-OS backend build.

---

```
You are setting up ALL of Marpin's platform developer apps. Marpin is an AI marketing operating system at https://www.marpin.ai (repo: /Users/gabriel/Desktop/Marin). Customers sign in and connect THEIR OWN accounts through Marpin's developer apps; Marpin then reads their metrics AND (new) executes marketing actions (post/create) on their behalf with approval.

YOUR GOAL: for every platform below, (1) create/configure Marpin's developer OAuth app, (2) set the redirect URIs, (3) enable the READ scopes and REQUEST the WRITE scopes — submitting for app review/verification where required, (4) capture each app's client id + secret so they can be set in Vercel, (5) report status + review ETAs. Drive the browser (Claude in Chrome) where you can; otherwise give exact click-by-click steps and the review-form answers.

READ THESE IN THE REPO FIRST (they hold the exact values — do not guess):
- src/lib/connectors/registry.ts  → per-platform authorizeUrl, tokenUrl, scopes, clientIdEnv/clientSecretEnv, usesPkce
- .env.example                    → the exact env var NAMES per platform (e.g. GOOGLE_OAUTH_CLIENT_ID, META_APP_ID, TIKTOK_APP_ID, LINKEDIN_CLIENT_ID, X_CLIENT_ID, PINTEREST_APP_ID, SNAPCHAT_CLIENT_ID, REDDIT_CLIENT_ID, AMAZON_ADS_CLIENT_ID, MICROSOFT_ADS_CLIENT_ID, APPLE_SEARCH_ADS_*)
- docs/marpin-action-os-plan.md   → the action layer + which WRITE scopes Phase 1 needs

REDIRECT URI to register on EVERY app (replace <platform> with the key):
  https://www.marpin.ai/api/connect/<platform>/callback
  http://localhost:3000/api/connect/<platform>/callback   (for dev)
Platform keys: google_ads, ga4, search_console (these THREE share ONE Google Cloud OAuth app), meta_ads, tiktok_ads, linkedin_ads, microsoft_ads, pinterest_ads, snapchat_ads, reddit_ads, x_ads, amazon_ads, apple_search_ads.

PER-PLATFORM:
- Google (Ads + GA4 + Search Console — ONE OAuth app in Google Cloud Console): consent screen + scopes (adwords, analytics.readonly, webmasters.readonly) + redirect URIs. Google Ads also needs a Developer Token (apply in the Ads API Center). Read-only; no posting.
- Meta (Facebook + Instagram — ONE app at developers.facebook.com): READ ads_read, business_management. WRITE (needs App Review + Business Verification): pages_manage_posts, instagram_content_publish, ads_management. Submit for review.
- X / Twitter (developer.x.com) — PHASE 1 PRIORITY: OAuth2 app; scopes tweet.read, users.read, offline.access + WRITE tweet.write. Needs a paid/elevated tier. This is Marpin's first real one-click executor — do this FIRST.
- LinkedIn (linkedin.com/developers): READ r_ads, r_ads_reporting. WRITE w_member_social / w_organization_social via the Community Management API (needs review + a verified Company Page admin). Submit.
- TikTok (business-api.tiktok.com): ads read + the Content Posting API (video.publish) — needs app audit + a linked Business account. Submit.
- Microsoft / Bing (Azure AD app): https://ads.microsoft.com/msads.manage + a Developer Token.
- Pinterest, Snapchat, Reddit, Amazon Ads, Apple Search Ads: create the app, set redirect URIs, enable the read scopes from registry.ts.

DELIVERABLE per platform: { env var name + client id + secret to paste into Vercel → Settings → Environment Variables (Production) }, scopes granted, and app-review status + ETA. Prioritise the long poles (X tweet.write, Meta + LinkedIn write reviews) since those gate real one-click execution.

Do NOT enter the secrets into the repo or any file — report them to me and I'll place them in Vercel myself. Start now with X, then Meta + LinkedIn reviews, then the rest.
```

---

The action-OS backend (the `actionPlan` artifact + clickable execute buttons + `/api/actions/execute` + assets + the X executor) is being built in the main session in parallel.
