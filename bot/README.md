# BadgeStatus Twitch bot

A Twitch chat bot for [twitch.tv/badgestatus](https://www.twitch.tv/badgestatus) that answers badge commands.
It runs as a free **Cloudflare Worker** — no server to keep running.

## Commands

| Command | Reply |
| --- | --- |
| `!<badge name>` | How to get the badge, dates, time left, link — e.g. `!gallica`, `!welcome2miami`, `!warrior-jar-alexander` |
| `!badge <name>` | Same as above |
| `!badges` | All badges available right now |
| `!next` | The next badge drop with countdown |
| `!ending` | The five badges ending soonest |
| `!missing [user]` | Which available badges a user is missing (defaults to whoever asked) |
| `!badgestatus` | List of commands |

Badge commands are generated from `https://badgestatus.net/data/badges.json` (re-read every 5 minutes):
a new badge gets its command automatically, an ended badge stops answering. Nothing to maintain.

## How it works

```
viewer types !gallica ──► Twitch EventSub (channel.chat.message) ──► POST /eventsub on the Worker
                                                                        │ verifies the signature
                                                                        │ looks up badges.json
Twitch chat ◄── Helix "Send Chat Message" ◄─────────────────────────────┘
```

- `src/commands.js` — all command logic (pure functions, tested with the real badge data)
- `src/index.js` — the Worker: webhook, Twitch API, one-time `/auth` setup, status page at `/`
- `test/` — `npm test` (no network needed)

## One-time setup

1. **Twitch app** — [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) → *Register Your Application*
   - Name: `BadgeStatus Bot`, Category: *Chat Bot*, Client type: *Confidential*
   - OAuth Redirect URL: `https://badgestatus-bot.<your-subdomain>.workers.dev/callback` (you see the exact URL after the first deploy — you can add it then)
   - Copy the **Client ID** and create a **Client Secret**
2. **Cloudflare** — free account at [dash.cloudflare.com](https://dash.cloudflare.com)
   - *My Profile → API Tokens → Create Token →* template **Edit Cloudflare Workers**
   - Note the **Account ID** (Workers & Pages overview, right side)
3. **GitHub secrets** — repo *Settings → Secrets and variables → Actions → New repository secret*:
   - `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`
   - `EVENTSUB_SECRET` — any random string, 10–100 characters
   - `GH_DISPATCH_TOKEN` *(recommended)* — keeps the website data fresh: GitHub's own schedule for the
     badge sync is unreliable, so the Worker triggers it every 15 minutes. Create a fine-grained token at
     *GitHub → Settings → Developer settings → Fine-grained tokens*: repository **TukSieben/Status**,
     permission **Actions: Read and write**.
4. **Deploy** — *Actions → Deploy Twitch bot → Run workflow* (later pushes to `bot/` deploy automatically)
5. **Connect** — open `https://badgestatus-bot.<your-subdomain>.workers.dev/auth` while logged in to Twitch as
   **badgestatus** and allow access. The page confirms "BadgeStatus bot is connected ✓". Type `!badges` in chat.

### Separate bot account (optional)

Set `BOT_LOGIN` in `wrangler.toml` to the bot account. Open `/auth` once as the bot account and once as the
channel (or make the bot a moderator).
