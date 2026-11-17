# BadgeStatus

Source of **[badgestatus.net](https://badgestatus.net)** — a tracker for Twitch global badges: what you can earn right now, what's coming next, and which ones you're still missing. Companion site to the 24/7 stream at [twitch.tv/badgestatus](https://www.twitch.tv/badgestatus).

The site is fully static and hosted on GitHub Pages. Badge data is refreshed every two hours by a GitHub Action.

## Pages

| URL | File | What it does |
| --- | --- | --- |
| `/` | `index.html` | Homepage: username check, schedule, ending soon / starting next |
| `/badges/` | `badges/index.html` | Badge tracker with username check (owned / missing), filters, upcoming list |
| `/badge/?id=<setID>` | `badge/index.html` | Detail page for a single badge |
| `/archive/` | `archive/index.html` | Every badge ever released: search, status / category / cost filters, sorting (filters are kept in the URL) |
| `/overlay/` | `overlay/index.html` | 1920×1080 overlay for the 24/7 stream (OBS browser source) |
| — | `404.html` | Not-found page (also redirects old `badges.html` / `badge.html` links) |

## Project structure

```
.
├── index.html                 # Homepage
├── badges/index.html          # Badge tracker
├── badge/index.html           # Badge detail page
├── archive/index.html         # Full badge archive
├── overlay/index.html         # Stream overlay (OBS)
├── 404.html
├── assets/
│   ├── css/
│   │   ├── base.css           # Design tokens, reset, nav, buttons, layout, pills, footer
│   │   ├── components/        # Reusable blocks: cards + lists, stream, schedule
│   │   └── pages/             # Page-specific styles: home, badges, badge, archive, overlay
│   ├── js/
│   │   ├── lib/
│   │   │   ├── utils.js       # Shared helpers (DOM, dates, badge data, Twitch GQL)
│   │   │   ├── twitch.js      # twitch.tv/badgestatus live status
│   │   │   ├── schedule.js    # Draggable schedule timeline
│   │   │   ├── dark-veil.js   # WebGL2 background renderer (port of React Bits' DarkVeil)
│   │   │   └── background.js  # Mounts the animated site background
│   │   └── pages/             # One entry script per page: home, badges, badge, archive, overlay
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
3. For channel-restricted drops the sync also stores the eligible channels (`channels: [{login, displayName, avatar}]`), which the badge page shows with live status.
4. Every page loads `/data/badges.json` in the browser. The username check and the stream status call Twitch directly from the browser — there is no backend.

## Stream overlay

Add a **Browser Source** in OBS:

- URL: `https://badgestatus.net/overlay/`
- Width `1920`, height `1080`

Options (append to the URL):

| Option | Effect |
| --- | --- |
| `?transparent=1` | No background, to layer the overlay over your own scene |
| `?rotate=20` | Seconds per page of available badges (default 15) |

The overlay reloads the badge data every 5 minutes and updates all countdowns every second; it never needs a manual refresh.

## Local development

Pages use root-absolute paths (`/assets/...`, `/data/...`), so serve the repository root:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```


## Conventions

- All site text is in **English**.
- Usernames are never stored: the tracker only checks a user from the search box or a `?user=` link.
- No build step and no dependencies: plain HTML, CSS and ES modules.
- Bump the `?v=` query on CSS/JS links in the HTML files when changing assets, so browsers pick up the new version.
