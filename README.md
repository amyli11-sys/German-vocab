# German 1000 — Spaced Repetition

A tiny installable web app: flashcards for the 1000 most common German words,
scheduled with an Anki-style SM-2 spaced repetition algorithm. No backend,
no account, no tracking — everything lives in your phone's browser storage.

## Deploy to GitHub Pages (5 minutes)

1. Create a new repository on GitHub (e.g. `german-srs`), public.
2. Upload every file in this folder to the repo root:
   `index.html`, `styles.css`, `app.js`, `data.json`, `manifest.json`, `sw.js`,
   and the `icons/` folder.
   - Easiest way: on the repo page, click **Add file → Upload files**, drag
     everything in, commit.
3. Go to **Settings → Pages**.
4. Under "Build and deployment", set **Source: Deploy from a branch**,
   branch **main**, folder **/ (root)**. Save.
5. Wait ~1 minute, then GitHub gives you a URL like:
   `https://yourusername.github.io/german-srs/`

## Add to your phone's home screen

**iPhone (Safari):** open the URL → tap the Share icon → **Add to Home Screen**.
**Android (Chrome):** open the URL → tap the ⋮ menu → **Add to Home screen** /
**Install app**.

**If you've done this before and the icon still looks wrong:** Safari caches
the old icon and the old service worker aggressively. Remove the existing
home-screen icon first, then in Safari go to *Settings → Safari → Advanced →
Website Data*, find your GitHub Pages URL, and delete it. Re-open the URL,
let it fully load once, then Add to Home Screen again.

It'll open full-screen, work offline after the first load (via the service
worker), and keep your review progress in the browser's local storage on
that device.

## How the scheduling works

This mirrors Anki's default algorithm (a variant of SM-2), not the "textbook"
1987 SM-2:

- **New cards** go through learning steps (1 min → 10 min) before graduating
  to daily reviews.
- Each review card has an **ease factor** (starts at 2.50 / 250%).
- Grading **Good** multiplies the current interval by the ease factor.
- **Hard** grows the interval only slightly and lowers ease a bit.
- **Easy** grows the interval more and raises ease.
- **Again** (a lapse) halves the interval, drops ease, and sends the card
  back through a short relearning step.
- 20 new cards/day by default (adjustable on the dashboard) — this matches
  Anki's default daily new-card limit.

## Extending to all 1000 words

Right now `data.json` has the first 200 words (by frequency) from the
Adsonant subtitle-frequency list, each with a hand-written example sentence.
Once you're happy with how the app feels, tell me and I'll write sentences
for the remaining 800 and expand `data.json` — the app itself needs no
changes, it just reads whatever is in that file.

## Files

- `index.html` — structure
- `styles.css` — dark-mode mobile UI
- `app.js` — SM-2 scheduler + review flow + localStorage persistence
- `data.json` — word/sentence data (edit this to add words)
- `manifest.json` + `sw.js` + `icons/` — PWA installability & offline support
