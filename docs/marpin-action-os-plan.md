# Marpin Action-OS — validated plan (2026-06-24)

Marpin = "Cursor for marketing": Claude (Sonnet) is the brain, Marpin is the executor via platform APIs + UI. The workspace becomes an **action plan with clickable execute buttons**, not text. Validated by a plan→review loop (3 architects + a skeptical staff-engineer validator). **Verdict: GO on Phase 1.**

## Shape (minimal, rides the existing seam)
One new artifact kind (`actionPlan`) + one new tool (`add_action_plan`) + one non-streaming endpoint (`POST /api/actions/execute`). No loop/reducer/route rewrite. The canvas card is the only client-stateful artifact (owns its step states; the click is a plain `fetch`, not SSE).

## Security spine (non-negotiable)
- **Persist at propose-time.** When the agent proposes a plan, the server writes one `Action` row per step with a **server-computed** `execMode` + `requiresApproval` (from a static capability table) and the validated payload. The model proposes *intent only* — never the money/approval flag.
- **Execute sends only `{ actionId }`.** No client-supplied payload (prevents a confused-deputy: a click can't smuggle an inflated budget or rewritten post). `Action.id` is the idempotency key (double-click safe). Role-gated (owner/admin). Money + public posting are **never** auto-executed — the click is the approval.

## Honest execution reality (`execMode` = api | prepare | guided)
The universal, always-works spine is **prepare + deep-link** (Marpin writes everything, opens the platform prefilled — moves no money, click is still the approval). Real one-click API execution is gated behind each platform's app review.

| Action | Phase 1 | Why |
|---|---|---|
| X / Twitter post | **`api` (real)** when `tweet.write` is live, else `guided` | The one clean single-POST write (OAuth2 PKCE already wired) |
| LinkedIn/Google Business **page** | `guided` (prepare + open) | No public API to create a Page/GBP |
| All **paid ad** creation | `guided` (prepare brief + deep-link) | Money-gated, heavy, per-platform app review |
| TikTok / Instagram organic posts | `guided` | Content Posting APIs need app review + linked Business accounts |
| SEO / website / email copy | `prepare` (Copy brief / Mark done) | Off-platform; no OAuth |

The capability table makes a button **never lie**: no write scope → it shows "Open ▸", not "Post". **App-review submissions (Meta, X, LinkedIn, TikTok) are the long pole — start them in parallel.**

## Phases
- **Phase 1 (ship):** hide Opus + single interface · clarify v2 (`ask_questions` multi-panel; plain-text when no business; budget+market with "Decide for me" before any strategy) · `actionPlan` artifact + tool + server-enrich + `CanvasActionPlan` renderer · `Action`/`Asset` Prisma models · `/api/actions/execute` (id-only, role-gated, idempotent, audit-via-Action) · **prepare/guided spine for all + X as the single real `api` proof** · asset upload (Vercel Blob, graceful without token).
- **Phase 2:** real org/page posting (LinkedIn/Meta/IG/Reddit/Pinterest) as app reviews land · lazy read→write scope re-consent · step status persisted across turns.
- **Phase 3:** ad-campaign *creation* (PAUSED draft + 2nd "Set live" approval) · scheduling ("post daily") via Inngest cron · approve-all batches · cost preview · asset library UI.

## Ordered Phase-1 tasks (each compiles green with no keys)
1. `TIER_MODEL.high → "claude-sonnet-4-6"`; picker/SELECTABLE Opus-free. *(done)*
2. Delete Thread/Report + `mode`; always SplitView.
3. `choices → { questions: AskQuestion[] }`; `ask_question → ask_questions`; multi-group `ChoiceChips`; prompt two-shape clarify rule.
4. Prompt action-space paragraph + `serializeArtifact` case.
5. Prisma `Action` + `Asset` (+ Workspace relations); migrate.
6. `src/lib/actions/{capability,persist}.ts`; `ActionPlanData`/`ActionStep`/`ProposedStep` types; `actionPlan` artifact kind.
7. `add_action_plan` tool + coercer; loop intercept; thread `workspaceId` into `runAgentWithTools`.
8. `CanvasActionPlan.tsx` + register in `AnswerCanvas`.
9. `/api/actions/execute` (id-only, role gate, idempotent, dispatch by execMode); connector `executeAction?` optional contract; `writeScopes`/`writeCapable` + OAuth `mode`.
10. `storage/blob.ts` + `@vercel/blob` + `/api/assets` (+`[id]`); asset slot in the card.
11. `XAdsClient.executeAction` (tweet.write) behind `writeCapable`, degrading to guided.

## Top risks
1. Confused-deputy on execute → mitigated by persist-at-propose + id-only POST (do not regress).
2. Model writes prose instead of `add_action_plan` → prompt paragraph + tool desc; 1–2 prompt iterations on first live run.
3. Write-scope app reviews (Meta/X/LinkedIn/TikTok) → `execMode` degrades `api → guided` so buttons never break; start reviews now.
4. Money safety → no API path spends from one click in P1 (paid = prepare/guided; ad drafts P3 forced PAUSED + 2nd approval).
