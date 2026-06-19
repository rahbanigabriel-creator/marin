# Marin

An AI marketing copilot for digital marketers — chat with your ad data across
Google Ads, Meta, GA4, TikTok, and LinkedIn, and get answers as living visual
artifacts (KPIs, charts, leak/funnel breakdowns, recommendations, and ready-to-
launch campaign drafts) that reveal in sequence as the response streams.

This repository currently contains **Milestone 1**: a faithful, pixel-accurate
prototype of the product UI driven by canonical mock data. The architecture is
built so the auth, database, and live-integration phases drop in without
reworking the views.

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS** with all design tokens encoded as CSS variables
- Hand-rolled SVG charts (no charting dependency)
- `next/font` — Hanken Grotesk, Newsreader, JetBrains Mono

Planned for later phases: **Clerk** auth (Google OAuth, B2B + B2C),
**Postgres + Prisma**, and a connector layer for the ad platforms with a mock
provider fallback.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Milestone 1 needs **no environment variables**. See `.env.example` for the
configuration the auth / DB / integration phases will use.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Next.js lint |

## Architecture notes

- **Streaming seam.** Views consume a typed `{ step, typed }` surface plus a
  `StreamEvent` schema. Milestone 1 feeds this from a timer-based
  `useStreamingDemo` hook; the real product swaps in an SSE-backed
  `/api/chat` stream without changing any view.
- **Step model.** `gatesForStep(step, …)` centralizes the staged-reveal logic
  (steps 0→7) shared by the Split, Thread, and Report views.
- **Canonical data.** `src/lib/data/canonical.ts` holds the single source of
  truth for the demo answer; live connectors will produce the same
  `AnswerData` shape.

## Directory map

```
src/
  app/                 # Next.js App Router entry (layout, page, globals)
  components/
    shell/             # AppShell orchestrator, Sidebar, TopBar
    views/             # Split / Thread / Report layouts
    chat/              # Composer, typewriter, user/assistant blocks
    canvas/            # KPI row, combo chart, leaks/funnel, recs, campaign
    modals/            # Connections modal
    ui/                # Small primitives (thinking dots, …)
  hooks/               # useStreamingDemo
  lib/
    data/              # canonical answer + chart math
    streaming/         # event schema + step gating model
  types/               # shared view & artifact types
  styles/              # design tokens (CSS variables)
```
