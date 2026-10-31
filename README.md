# Voice Lab

Personal voice, presentation and persuasion trainer. A phone web app (installable to the home screen) plus a small backend that holds the API keys.

Built from the **Eloquence** handoff spec (v1.1), with these agreed changes:

| Spec | Voice Lab | Why |
|---|---|---|
| Next.js + SQLite on a laptop | Phone web app on GitHub Pages + Cloudflare Worker | Practise on the phone; keys stay off the phone |
| SQLite + media folder | IndexedDB on the phone | Still local-first, single user |
| English + Thai not specified | English | User's choice |
| Delivery metrics only | Plus on-device pitch, pitch variation and volume steadiness | From the original Voice Lab goal |

## Status

- **Phase 1 (done):** backend with test provider, settings with provider status, recording with review before submit, transcription, delivery metrics, typed answers, history, deletion controls.
- Phase 2: coach report with quote-checked ratings, targeted drill, retry and compare.
- Phase 3: persuasion. Phase 4: negotiation engine. Phase 5: objections and closing, voice drills, progress view.

## Layout

```
index.html, app/      phone app (no build step)
lib/                  shared pure code: metrics, pitch, prompts, test provider
api/                  backend handlers (Web-standard Request/Response)
worker.js             Cloudflare entry: routing + CORS
scripts/dev.mjs       local server: app + API on one address, test provider when no keys
check.html            device check page
test/                 unit tests; test/e2e = phone-size browser test
```

## Run and test

```
npm run dev        # http://localhost:8787 — test provider unless keys are set in the environment
npm test           # unit tests, no credentials needed
npm run test:e2e   # phone-size browser test with a simulated mic (needs Playwright)
```

No `npm install` is needed: the code has no dependencies.

## Modes

- **Demo** — no backend address in Settings. Transcripts are a canned sample and say so. Nothing leaves the phone.
- **Test** — backend running with no keys. Same canned sample, through the real API path.
- **Live** — backend with providers configured. Real transcripts.

## Deploy the backend (Cloudflare)

1. Create a free Cloudflare account.
2. `npx wrangler login`
3. `npx wrangler secret put APP_ACCESS_CODE` — any long passphrase. The app sends it with each request.
4. `npx wrangler deploy` — prints the backend address (`https://voice-lab-api.<you>.workers.dev`).
5. On the phone: Settings → Backend address + access code → Save and check.

Transcription uses Deepgram Nova-3 hosted by Cloudflare (no Deepgram account needed). To use Deepgram directly instead: `npx wrangler secret put DEEPGRAM_API_KEY`.

**First live test:** the Cloudflare-hosted model's input format comes from its published schema and has not yet been run against a real call. Record one short drill after deploying; if transcription fails, the error appears on the phone and the recording stays saved for retry.

## Privacy

Drills, transcripts and numbers are stored only on the phone. Recordings are deleted once transcribed unless "Keep recordings" is turned on. With a backend set, audio goes to the transcription provider (and, from Phase 2, transcripts to the coaching provider), nothing else. No analytics. Keys live only in server secrets; the app shows whether they are configured, never their values.

## Acceptance tests (spec §11) — Phase 1 results

| # | Test | Status |
|---|---|---|
| 7 | Typed session: no vocal scores, reasons shown | Pass (unit + e2e) |
| 8 | Missing timing → null with reason, not zero; talk-time null when counterparty unmeasured | Pass (unit + e2e) |
| 12 | History persists; delete one; delete all empties data and recordings | Pass (e2e) |
| 13 | Provider absent/failing → attempt kept, retry offered; tests run without credentials | Pass (unit + e2e) |
| 14 | Keys never in client responses; `.env` gitignored; local server binds to loopback | Pass (unit + config) |
| 1–6, 9–11 | Coach, persuasion, negotiation, objections | Phases 2–5 |
