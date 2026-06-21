# Marin Pricing Strategy v1

> Goal: four tiers (Free → Solo → Business → Max/Enterprise) that each buyer is happy to pay, **profitable even at the usage cap** (not just on average), with a generous-but-bounded included allowance and paid top-ups. Designed against real model COGS and high CAC.

## 1. The metering unit — "Marin credits" (token-backed)

We meter in **Marin credits**, where **1 credit = 1 standard answer** (a full streamed chat-plus-visual response). Credits are the friendly face of the underlying token budget — every answer consumes model tokens, and a credit is the normalized unit on top so users aren't reasoning about millions of raw tokens (most of which are the cached system/playbook prefix and would distort the count).

- A **deep answer** (Opus deep-dive, forecast, multi-channel strategy) consumes **2 credits** — shown in the UI before it runs.
- A **quick lookup** (Haiku/simple) consumes **1 credit** (rounded down to 1; very cheap ones may be free of charge in practice).
- Included credits are the plan's **token allowance**; **top-up packs** are the "buy extra tokens."

This keeps the promise ("included tokens + buy more") while staying legible and **letting heavier (costlier) answers consume more allowance — which is what protects margin.**

## 2. Cost model (COGS per credit)

From the architecture's model strategy (Haiku $1/$5, Sonnet 4.6 $3/$15, Opus 4.8 $5/$25 per MTok; ~80K cached prefix at ~0.1× cache-read; tier mix ~70% Sonnet / 20% Haiku side-calls / 10% Opus):

| Answer type | Model | ~COGS/answer |
|---|---|---|
| Quick lookup | Haiku / light Sonnet | ~€0.03 |
| Standard answer (tools + artifacts) | Sonnet 4.6 | ~€0.10 |
| Deep analysis / forecast | Opus 4.8 | ~€0.25 (= 2 credits) |

**Planning COGS = €0.12 per credit** (conservative blend incl. tool-side costs: warehouse query, occasional SEMrush credits, web_search). Plus **fixed cost per active workspace/month** (warehouse storage + sync compute + connector/external-data subscriptions + hosting), which scales with connected accounts: ~€4 (Solo) → ~€25 (Business, multi-client) → ~€110 (Max, 20+ clients). Plus payment processing ~3% + €0.30/txn.

**Margin discipline:** included credits are capped so that **even if a user burns 100% of the cap**, gross margin stays positive (≥~50% on Solo); because typical usage is far below the cap (~30–40%), blended gross margin per tier lands **~70–85%**. Top-ups are always priced above marginal COGS. The router (architecture §1–2) **enforces** the credit budget — it downgrades tier / caps effort / serves from cache as the limit nears, and only refuses at the hard ceiling, so cost can never run unbounded.

## 3. The four plans

| | **Free** | **Solo Founder** | **Business** | **Max / Enterprise** |
|---|---|---|---|---|
| **Price** | €0 | **€39.99/mo** · €399/yr (2 mo free) | **€149/mo** · €1,490/yr | **from €599/mo** (custom) |
| **Included credits/mo** | **25** | **120** | **600** (pooled) | **3,000** (pooled) |
| **Connected channels** | 1 | up to 4 | up to 12 / 5 client workspaces | unlimited (fair use) |
| **Seats** | 1 | 1 | 5 | unlimited (fair use) |
| **Models** | Haiku + Sonnet (no Opus) | + Opus via router | + Opus priority | Opus max-effort lane |
| **Actions / write-back** | — | gated, single-account | gated, multi-account | gated + bulk + approvals workflow |
| **Reports** | in-app, Marin-branded | PDF export (unbranded) | white-label + scheduled | white-label + scheduled + API |
| **Agency book view** | — | — | multi-client roster + alerts | full portfolio + rollups |
| **Security/compliance** | — | — | audit log | SSO/SAML, RBAC, SLA, data residency |
| **Support** | community | email | priority | dedicated CSM |
| **Top-up packs** | upgrade to unlock | €30 / 100 credits | €100 / 500 credits | €150 / 1,000 credits |
| **Top-up €/credit** | — | €0.30 | €0.20 | €0.15 |

Credits **roll over one month** (cap 1× the monthly allowance) so "use it or lose it" doesn't bite — bounded so liability stays predictable. Higher tiers get a **cheaper marginal credit** (top-ups and effective rate fall as you climb), which is the natural upgrade incentive.

## 4. Unit economics & margin check

COGS €0.12/credit; typical usage ≈ 35% of cap.

| Plan | Typical credits | Typical COGS + fixed + fees | **Typical gross margin** | At-cap COGS + fixed + fees | **At-cap margin** |
|---|---|---|---|---|---|
| Solo €39.99 | ~45 | €5.4 + €4 + €1.5 = €10.9 | **~73%** | 120 → €14.4 + €4 + €1.5 = €19.9 | **~50%** |
| Business €149 | ~250 | €30 + €25 + €5 = €60 | **~60%** | 600 → €72 + €25 + €5 = €102 | **~32%** (then top-ups) |
| Max €599 | ~1,200 | €144 + €110 + €18 = €272 | **~55%** | 3,000 → €360 + €110 + €18 = €488 | **~18%** → Enterprise is **custom-quoted** to hold ≥60% on large books |

- **Solo is profitable at the cap (~50%) and very profitable typically (~73%)** — exactly the "generous but still very profitable even at €39.99" requirement. The 120-credit cap (~4 answers/day) is generous for one brand while bounding worst-case COGS to ~€14.
- **Top-ups are margin-positive** (€0.30 / €0.20 / €0.15 per credit vs €0.12 COGS = 60% / 40% / 20% margin) and priced so it's always cheaper to move up a tier than to keep buying top-ups — driving expansion.
- **Free is a bounded loss-leader:** 25 credits, no Opus, 1 connection → COGS ≤ ~€1.5/active/mo; abuse-bounded by the connection limit + rate limits.

## 5. The Free plan — built to WOW, then convert

Free must deliver the exact moment that won PMF, then hit a wall that makes upgrading obvious:
- **WOW:** the full first **audit answer** with real charts/KPIs/funnel/leaks (the "you're leaking €11.5k/mo" moment) — chat **and** visuals, on one connected channel. 25 credits ≈ a real audit plus a handful of follow-ups.
- **Walls that sell the upgrade:** no Opus (so "deep" questions show a "Solo unlocks deeper analysis" prompt), no export/share (CMO can't take it to the board → upgrade), no actions (founder can't launch → upgrade), 1 channel (CMO/agency need cross-channel → upgrade), Marin-branded reports.
- **Conversion nudges:** a small one-time top-up offer at the credit wall; a "connect a 2nd channel → see cross-channel comparison (Solo)" teaser; the agency client-roster preview locked behind Business.

## 6. CAC, payback & expansion (why margins must be this high)

With high CAC, contribution margin and prepay drive survival:
- **Annual prepay (~2 months free)** on every paid tier — improves cash and shortens payback; the default CTA.
- **Payback math:** Solo contributes ~€29/mo (73% of €39.99) → a €200 CAC pays back in ~7 months (faster on annual). Business contributes ~€89/mo → ~€1k CAC ≈ 11 months. So the motion leans on **Free→Solo self-serve (low CAC)** and **Solo→Business/Max expansion** (near-zero CAC) rather than buying Enterprise logos cold.
- **Expansion levers (add-ons):** extra connected channels, extra seats, extra client workspaces (agencies), and credit top-ups — all margin-positive, all reasons ARPA grows without re-acquiring.
- **The pricing fixes the PMF risk** the product owner flagged: the four personas validated the *same* €39.99, but a 20-client agency and a solo founder cannot be one SKU — Business/Max + per-client/seat add-ons capture the agency's higher willingness-to-pay and stop a flat price from inverting margin at agency volume.

## 7. Guardrails that keep us profitable

1. **Hard per-tenant credit budget enforced in the router** (architecture §1–2) — never unbounded spend; downgrade/serve-from-cache before the cap, opt-in top-ups beyond it.
2. **Deep answers cost 2 credits** — heavier (costlier) work consumes more allowance automatically.
3. **At-cap margin ≥ ~50% on Solo** by construction (cap × COGS bounded well under price).
4. **Top-ups always above marginal COGS**; cheaper per-credit as you climb (upgrade incentive).
5. **Free bounded** (no Opus, 1 connection, rate-limited) so trial cost can't balloon.
6. **Annual prepay default** to shorten CAC payback.

## 8. Open decisions (business, not engineering)
- Final price points (€39.99 / €149 / €599) vs willingness-to-pay testing.
- Whether the agency motion needs a dedicated per-client price (e.g. €X/connected client) inside Business/Max instead of pooled credits.
- Free credit amount (25) vs conversion-rate testing (lower = more upgrade pressure, higher = more WOW).
- Regional pricing (USD/GBP) and VAT handling for EU.
