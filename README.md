# BadgeStatus

Source of **[badgestatus.net](https://badgestatus.net)** — a tracker for Twitch global badges: what you can earn right now, what's coming next, and which ones you're still missing. Companion site to the 24/7 stream at [twitch.tv/badgestatus](https://www.twitch.tv/badgestatus).

The site is fully static and hosted on GitHub Pages. Badge data is refreshed every two hours by a GitHub Action.

## Pages

| URL | File | What it does |
| --- | --- | --- |
| `/` | `index.html` | Homepage: schedule, ending soon / starting next, newest drops, stream chat sidebar |
| `/badges/` | `badges/index.html` | Badge tracker with username check (owned / missing), filters, schedule, upcoming list |
| `/badge/?id=<setID>` | `badge/index.html` | Detail page for a single badge |
| — | `404.html` | Not-found page (also redirects old `badges.html` / `badge.html` links) |

## Project structure

```
.
├── index.html                 # Homepage
├── badges/index.html          # Badge tracker
├── badge/index.html           # Badge detail page
├── 404.html
├── assets/
│   ├── css/
│   │   ├── base.css           # Design tokens, reset, nav, buttons, layout, pills, footer
│   │   ├── components/        # Reusable blocks: cards, stream, schedule
│   │   └── pages/             # Page-specific styles: home, badges, badge
│   ├── js/
│   │   ├── lib/
│   │   │   ├── utils.js       # Shared helpers (DOM, dates, badge data, Twitch GQL)
│   │   │   ├── twitch.js      # twitch.tv/badgestatus live status + chat embed
│   │   │   └── schedule.js    # Draggable schedule timeline
│   │   └── pages/             # One entry script per page: home, badges, badge
│   └── img/
│       └── logo.png
├── data/
│   ├── badges.json            # Badge snapshot (generated — do not edit by hand)
│   └── changelog.json
├── scripts/
│   └── sync_badges.py         # Builds data/*.json from Twitch, StreamDatabase, CatQuery, PotatBotat
└── .github/workflows/
    └── sync-badges.yml        # Runs the sync every 2 hours and commits changes
```

## Data flow

1. `sync-badges.yml` runs `scripts/sync_badges.py` every two hours (or manually via *Run workflow*).
2. The script writes `data/badges.json` and commits it if anything changed.
3. Every page loads `/data/badges.json` in the browser. The username check and the stream status call Twitch directly from the browser — there is no backend.

## Local development

Pages use root-absolute paths (`/assets/...`, `/data/...`), so serve the repository root:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

The Twitch chat embed only loads on `badgestatus.net` (Twitch requires a matching `parent` domain).

## Conventions

- All site text is in **English**.
- No build step and no dependencies: plain HTML, CSS and ES modules.
- Bump the `?v=` query on CSS/JS links in the HTML files when changing assets, so browsers pick up the new version.
