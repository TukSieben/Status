// One-game badge overlay for gameplay streams: every badge of that game, free (watch) and paid (sub).
import { $, el, badgeImg, loadBadges, watchBadges, reloadOnUpdate } from "../lib/utils.js";

const params = new URLSearchParams(location.search);
const GAME = (params.get("game") || document.body.dataset.game || "").trim();
const SHOW_PAID = params.get("paid") !== "0";
const THEME = params.get("theme") || document.body.dataset.theme || "";
if (THEME) document.body.classList.add(`theme-${THEME}`);
if (params.get("side") === "left") $("stage").classList.add("is-left");

let badges = [];

/* ---------- fixed 1920×1080 stage ---------- */
function fit() {
  $("stage").style.transform = `scale(${Math.min(innerWidth / 1920, innerHeight / 1080)})`;
}
addEventListener("resize", fit);
fit();

/* ---------- helpers ---------- */
const base = (text) => String(text || "").replace(/\s*\((subscribe|watch|sub)\)\s*$/i, "").trim().toLowerCase();
const isSub = (b) => /subscri|gift/i.test(b.objective || "") || /\((subscribe|sub)\)/i.test(`${b.game} ${b.eventName}`) || (!b.objective && b.cost === "paid");
const watchTime = (b) => String(b.objective || "").match(/^watch\s+(.+?)\s+in\s/i)?.[1] || null;

function rel(ms) {
  const diff = Math.max(0, ms - Date.now());
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff / 3_600_000) % 24);
  const m = Math.floor((diff / 60_000) % 60);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${String(m).padStart(2, "0")}m`;
}

/** Same short command the bot uses: "Grand Theft Auto VI" → GTA6 (+FREE for the watch badges when sub badges exist too) */
function alias(game, withSubs) {
  const words = game.toUpperCase().match(/[A-Z0-9]+/g) || [];
  const roman = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
  const last = words[words.length - 1];
  const num = roman[last] ? String(roman[last]) : /^\d+$/.test(last || "") ? last : "";
  const head = num ? words.slice(0, -1) : words;
  const short = head.length >= 2 ? head.map((w) => w[0]).join("") + num : (head[0] || "").slice(0, 3);
  return short + (withSubs ? "FREE" : "");
}

/** Newest version per set, this game only, active or starting soon */
function gameBadges(now = Date.now()) {
  const g = GAME.toLowerCase();
  const bySet = new Map();
  for (const b of badges) {
    if (base(b.game) !== g && base(b.eventName) !== g) continue;
    const prev = bySet.get(b.setID);
    if (!prev || Number(b.version) > Number(prev.version)) bySet.set(b.setID, b);
  }
  const out = [];
  for (const b of bySet.values()) {
    const start = Date.parse(b.startAt || "");
    const end = Date.parse(b.endAt || "");
    if (Number.isNaN(end) || end <= now) continue;
    out.push({ b, upcoming: !Number.isNaN(start) && start > now, start, end });
  }
  return out;
}

/* ---------- render ---------- */
let lastKey = "";
function render() {
  const list = gameBadges();
  const active = list.filter((x) => !x.upcoming);
  const shown = active.length ? active : list.filter((x) => x.upcoming);
  const free = shown.filter((x) => !isSub(x.b));
  const paid = SHOW_PAID ? shown.filter((x) => isSub(x.b)) : [];
  const upcoming = !active.length && shown.length > 0;

  $("gmTitle").textContent = GAME || "Set ?game= in the URL";
  $("gmKicker").textContent = upcoming ? "Coming soon" : "Badges you can get here";

  const key = shown.map((x) => x.b.setID).join(",") + upcoming;
  if (key !== lastKey) {
    lastKey = key;
    const times = [...new Set(free.map((x) => watchTime(x.b)).filter(Boolean))];
    $("gmFreeLabel").textContent = times.length === 1 ? `Free · watch ${times[0]}` : "Free · watch";
    $("gmFreeGrid").replaceChildren(
      ...free.map((x) => {
        const t = el("div", "gm-tile");
        t.append(badgeImg(x.b, "", 4), el("span", "", x.b.title));
        return t;
      })
    );
    $("gmPaidRow").replaceChildren(
      ...paid.map((x) => {
        const t = el("div", "gm-mini");
        t.append(badgeImg(x.b, "", 2), el("span", "", x.b.title));
        return t;
      })
    );
    $("gmFree").hidden = !free.length;
    $("gmPaid").hidden = !paid.length;
    $("gmEmpty").hidden = shown.length > 0;

    // the bot names a separate "(Watch)" campaign …FREE (GTA6FREE), a mixed one just by the game (PAY)
    const cmd = alias(GAME, free.some((x) => /\(watch\)\s*$/i.test(x.b.eventName || "")));
    const foot = el("span");
    foot.append("Info: ", el("b", "", free.length ? `!${cmd}` : "!badges"));
    $("gmFoot").replaceChildren(foot, el("span", "", "badgestatus.net"));
  }

  // meta line: what it takes + time left / until start
  const meta = $("gmMeta");
  const lead = free[0] || paid[0];
  if (!lead) return meta.replaceChildren();
  const time = watchTime(lead.b);
  const chip = el("span", "gm-chip", free.length ? (time ? `Watch ${time} · Free` : "Free") : "Sub or gift a sub");
  const t = upcoming ? lead.start : Math.min(...shown.map((x) => x.end));
  const when = el("span", `gm-time${!upcoming && t - Date.now() < 48 * 3_600_000 ? " is-urgent" : ""}`);
  when.append(upcoming ? "Starts in " : "Ends in ", el("b", "", rel(t)));
  meta.replaceChildren(chip, when);
}

const data = await loadBadges();
badges = data.badges;
render();
setInterval(render, 20_000);
watchBadges(
  (next) => {
    badges = next.badges;
    lastKey = "";
    render();
  },
  { syncedAt: data.syncedAt, intervalMs: 60_000 }
);
reloadOnUpdate();
