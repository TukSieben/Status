// Full-screen badge view for one game (default Old School RuneScape): free + sub badges side by side, countdown.
import { startDaylight, setVars } from "../lib/daylight.js?v=1";
import { startChatEcho, avatarOf } from "../lib/chat-echo.js?v=7";
import { startPixelAlien } from "../lib/pixel-alien.js?v=1";
import { startHunters } from "../lib/hunters.js?v=1";
import { startFollowGoal } from "../lib/follow-goal.js?v=1";
import { startMeme } from "../lib/meme.js?v=1";
import { startLiveTag } from "../lib/live-tag.js?v=4";
import { qrSvg } from "../lib/qr.js?v=2";
import { $, el, badgeImg, loadBadges, watchBadges, reloadOnUpdate } from "../lib/utils.js";

const params = new URLSearchParams(location.search);
const GAME = (params.get("game") || "Old School RuneScape").trim();
const SHOW_PAID = params.get("paid") !== "0";
const MOTION = params.get("motion") !== "0";
if (MOTION) document.body.classList.add("rs-motion");
let badges = [];

function fit() {
  $("stage").style.transform = `scale(${Math.min(innerWidth / 1920, innerHeight / 1080)})`;
}
addEventListener("resize", fit);
fit();

const base = (t) => String(t || "").replace(/\s*\((subscribe|watch|sub)\)\s*$/i, "").trim().toLowerCase();
const isSub = (b) => /subscri|gift/i.test(b.objective || "") || /\((subscribe|sub)\)/i.test(`${b.game} ${b.eventName}`) || (!b.objective && b.cost === "paid");
const watchTime = (b) => String(b.objective || "").match(/^watch\s+(.+?)\s+in\s/i)?.[1] || null;
const days = (b) => Number(String(b.description || "").match(/watching\s+(\d+)\s+days?/i)?.[1] || 0);
const pretty = (t) => (t || "").replace(/^(\d+)h$/, (_, h) => `${h} hour${h === "1" ? "" : "s"}`).replace(/^(\d+)m$/, "$1 min");

/** Short names used in chat and titles (same as the bot) */
const SHORT = { "old school runescape": "OSRS", "counter-strike 2": "CS2", "league of legends": "LoL", "world of warcraft": "WoW" };
const short = (g) => SHORT[g.toLowerCase()] || g;
/** Chat command like the bot: OSRS, GTA6, … */
function command(game) {
  if (SHORT[game.toLowerCase()]) return SHORT[game.toLowerCase()].toUpperCase();
  const words = game.toUpperCase().match(/[A-Z0-9]+/g) || [];
  const roman = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
  const last = words[words.length - 1];
  const num = roman[last] ? String(roman[last]) : /^\d+$/.test(last || "") ? last : "";
  const head = num ? words.slice(0, -1) : words;
  return head.length >= 2 ? head.map((w) => w[0]).join("") + num : (head[0] || "").slice(0, 3);
}

function rel(ms) {
  const diff = Math.max(0, ms - Date.now());
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff / 3_600_000) % 24);
  const m = Math.floor((diff / 60_000) % 60);
  return d > 0 ? `${d}d ${h}h ${String(m).padStart(2, "0")}m` : `${h}h ${String(m).padStart(2, "0")}m`;
}
const dateText = (ms) =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";

function gameBadges(now = Date.now()) {
  const g = GAME.toLowerCase();
  const bySet = new Map();
  for (const b of badges) {
    if (base(b.game) !== g && base(b.eventName) !== g) continue;
    const prev = bySet.get(b.setID);
    if (!prev || Number(b.version) > Number(prev.version)) bySet.set(b.setID, b);
  }
  return [...bySet.values()]
    .map((b) => ({ b, start: Date.parse(b.startAt || ""), end: Date.parse(b.endAt || "") }))
    .filter((x) => !Number.isNaN(x.end) && x.end > now);
}

/** One badge → big medallion; several → a row of cards */
function badgeBlock(list, how) {
  const one = list.length === 1;
  const wrap = $(how.id);
  wrap.className = `rs-badges ${one ? "is-one" : "is-many"}`;
  wrap.replaceChildren(
    ...list.map((x) => {
      const c = el("div", "rs-badge");
      const medal = el("div", "rs-medal");
      medal.appendChild(badgeImg(x.b, "", 4));
      c.append(medal, el("div", "rs-badge-name", x.b.title));
      const line = how.line(x);
      if (line) c.appendChild(el("div", "rs-badge-how", line));
      return c;
    })
  );
}

function steps(id, rows) {
  $(id).replaceChildren(
    ...rows.map((parts) => {
      const li = el("li");
      const span = el("span");
      span.append(...parts);
      li.append(span);
      return li;
    })
  );
}

let lastKey = "";
function render() {
  const now = Date.now();
  const list = gameBadges(now);
  const live = list.filter((x) => Number.isNaN(x.start) || x.start <= now);
  const shown = live.length ? live : list;
  const upcoming = !live.length && list.length > 0;
  const free = shown.filter((x) => !isSub(x.b)).sort((a, b) => days(a.b) - days(b.b) || a.b.title.localeCompare(b.b.title));
  const paid = shown.filter((x) => isSub(x.b) && /subscri|gift/i.test(x.b.objective || ""));

  // countdown
  const target = upcoming ? Math.min(...shown.map((x) => x.start)) : Math.min(...shown.map((x) => x.end));
  $("rsClockLabel").textContent = !shown.length ? "No badges" : upcoming ? "Starts in" : "Ends in";
  const clock = $("rsClock");
  const text = shown.length ? rel(target) : "—";
  if (clock.textContent !== text) {
    clock.textContent = text;
    if (MOTION) replay(clock, "is-tick");
  }
  $("rsDate").textContent = shown.length ? dateText(target) : "";

  const key = shown.map((x) => x.b.setID).join(",") + upcoming;
  if (key === lastKey) return;
  lastKey = key;

  const name = short(GAME);
  $("rsTitle").textContent = GAME;
  document.title = `${name} badges — BadgeStatus`;

  // free
  const time = [...new Set(free.map((x) => watchTime(x.b)).filter(Boolean))];
  const daily = free.some((x) => days(x.b) > 0);
  const t = time.length === 1 ? pretty(time[0]) : "the required time";
  $("rsFreePanel").hidden = !free.length;
  $("rsFreeHead").textContent = free.length > 1 ? "Free badges" : "Free badge";
  $("rsFreePill").textContent = time.length === 1 ? `Watch ${pretty(time[0])}${daily ? " a day" : ""}` : "Watch to earn";
  badgeBlock(free, {
    id: "rsFree",
    line: (x) => {
      const d = days(x.b);
      const wt = watchTime(x.b);
      return d ? `Day ${d} · ${wt ? pretty(wt) : "watch"}` : wt ? `Watch ${pretty(wt)}` : "";
    },
  });
  steps("rsFreeSteps", [
    ["Watch any ", el("b", "", `${name}`), " stream for ", el("b", "", t), daily ? " a day." : "."],
    ...(daily ? [["Come back the next day — ", el("b", "", "every day unlocks the next one"), "."]] : []),
    ["Progress: ", el("b", "", "twitch.tv/drops/inventory")],
  ]);

  // sub
  const n = paid.length;
  $("rsPaidPanel").hidden = !SHOW_PAID || !n;
  $("rsPaidHead").textContent = n > 1 ? "Sub badges" : "Sub badge";
  $("rsPaidPill").textContent = n > 1 ? `${n} subs` : "1 sub or gift sub";
  badgeBlock(paid, { id: "rsPaid", line: () => (n > 1 ? "1 sub each" : "") });
  steps("rsPaidSteps", [
    n > 1
      ? ["Each new sub or gift sub to a ", el("b", "", name), " streamer unlocks one — ", el("b", "", `${n} subs for all ${n}`), "."]
      : ["Subscribe or gift a sub to ", el("b", "", `any ${name} streamer`), "."],
    ["Tier 1 is enough, ", el("b", "", "Prime doesn't count"), "."],
  ]);

  $("rsMain").classList.toggle("is-single", $("rsFreePanel").hidden || $("rsPaidPanel").hidden);

  const foot = el("div");
  foot.append("Type ", el("b", "", `!${command(GAME)}`), " in chat for details");
  $("rsCmd").replaceChildren(foot);
}

/* ---------- motion: one short move every few seconds, nothing runs in between ---------- */
function replay(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}
let spot = -1;
function moveSpot() {
  const all = [...document.querySelectorAll(".rs-panel:not([hidden]) .rs-badge")];
  all.forEach((c) => c.classList.remove("is-spot"));
  if (!all.length) return;
  spot = (spot + 1) % all.length;
  all[spot].classList.add("is-spot");
}
if (MOTION) {
  setInterval(moveSpot, 5000); // spotlight walks over the badges
  setInterval(() => replay($("rsTitle"), "is-shine"), 14000); // gold sweep over the title
  setInterval(() => document.querySelectorAll(".rs-win").forEach((w) => replay(w, "is-flicker")), 9000); // castle windows flicker
  setInterval(() => replay(document.querySelector(".rs-flag"), "is-wave"), 21000); // flag waves
  setTimeout(() => replay($("rsTitle"), "is-shine"), 1800);
  setTimeout(moveSpot, 1200);
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

/* Day & night over the hills: starry night with lit windows, misty dawn, clear day, amber dusk */
startDaylight(
  [
    { h: 0, v: { s1: "#060a18", s2: "#0c1530", s3: "#16224a", s4: "#22305a", far: "#0c1428", near: "#060a14", win: "#ffc35a", stars: 1, moon: 0.95, glow: 0.9 } },
    { h: 6, v: { s1: "#1a2246", s2: "#3a3f6e", s3: "#8a6a86", s4: "#e8a77a", far: "#2a2c48", near: "#141628", win: "#ffc35a", stars: 0.25, moon: 0.35, glow: 0.5 } },
    { h: 12, v: { s1: "#2a5a8c", s2: "#4f7fae", s3: "#86a9c4", s4: "#c9d6c0", far: "#3c5a4a", near: "#1f3428", win: "#ffd98a", stars: 0, moon: 0, glow: 0 } },
    { h: 18, v: { s1: "#1a1838", s2: "#40305a", s3: "#9a5a5a", s4: "#f0a050", far: "#2a2236", near: "#140f1c", win: "#ffb84a", stars: 0.15, moon: 0.25, glow: 0.7 } },
    { h: 21, v: { s1: "#0a0e22", s2: "#141c3c", s3: "#2a2c52", s4: "#4a3a5a", far: "#121830", near: "#080b16", win: "#ffc35a", stars: 0.8, moon: 0.8, glow: 0.9 } },
  ],
  (v) => setVars($("stage"), v)
);

/* Chat echo in stone + gold */
$("stage").style.setProperty("--echo-bg", "rgba(22, 17, 12, 0.94)");
$("stage").style.setProperty("--echo-border", "rgba(226, 182, 92, 0.45)");
$("stage").style.setProperty("--echo-accent", "#e8c26a");
let goalBox = null;
const hunters = startHunters($("rsHunters"), { avatarOf });

/* Pixel alien standing on the top edge of the meme / badge panels, next to the castle */
const alien = startPixelAlien($("stage"), { left: 1227, top: 104, size: 96 });
function alienCommand(name, cmd) {
  if (!alien) return;
  const mine = cmd && cmd.slice(1).toLowerCase() === command(GAME).toLowerCase();
  const free = gameBadges().filter((x) => !isSub(x.b) && !(x.start > Date.now()));
  const t = free.length ? watchTime(free[0].b) : null;
  if (mine && free.length && t) alien.hop([`Watch ${pretty(t)}`, `→ ${free.length > 1 ? `${free.length} free badges` : free[0].b.title}`]);
  else alien.hop([`Good luck, ${name}!`, "happy hunting"]);
}

const echo = startChatEcho($("stage"), {
  position: { right: 76, bottom: 112 },
  getBadges: () => badges,
  onFollow: (name) => {
    goalBox?.bump();
    alien?.cheer([`Welcome, ${name}!`, "welcome to the hunt"]);
  },
  onCommand: (n, login, cmd) => {
    hunters?.add(n, login);
    alienCommand(n, cmd);
  },
});
goalBox = startFollowGoal($("rsGoal"), { onMilestone: (m) => echo?.celebrate(`${m.toLocaleString("en-US")} followers`) });

/* Meme clip in the header (only on the stream, from MEME_<command> in the server's .env) */
startMeme($("rsMeme"), command(GAME), (on) => $("stage").classList.toggle("has-meme", on));

/* "THIS IS LIVE · NOT A VOD" strip at the bottom */
startLiveTag($("stage"));

/* QR code to this game's badge page (badgestatus.net/c/<game>/) next to the countdown. ?qr=0 hides it */
if (params.get("qr") !== "0") {
  const slug = GAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const box = $("rsQr");
  const cap = el("div", "rs-qr-cap");
  cap.append(el("b", "", "Scan me"));
  // short links keep the code coarse enough to scan from a phone pointed at the stream
  const SHORT_LINKS = { "old-school-runescape": "https://badgestatus.net/osrs" };
  box.append(qrSvg(SHORT_LINKS[slug] || `https://badgestatus.net/c/${slug}/`), cap);
  box.hidden = false;
}

/* The title stays on one line: shrink it until it fits next to the QR code / countdown */
function fitTitle() {
  const title = $("rsTitle");
  const limit = ($("rsQr").hidden ? document.querySelector(".rs-clock") : $("rsQr")).getBoundingClientRect().left - 32;
  let size = 88;
  title.style.fontSize = `${size}px`;
  while (title.getBoundingClientRect().right > limit && size > 44) {
    size -= 2;
    title.style.fontSize = `${size}px`;
  }
}
document.fonts?.ready.then(fitTitle);
setTimeout(fitTitle, 1500);
setInterval(fitTitle, 30_000); // title text can change (new game); cheap, no paint when nothing changes

/* ?aliendemo=1 → follow + command reactions every few seconds (to try it out) */
if (alien && params.get("aliendemo") === "1") {
  const demo = () => {
    alien.cheer(["Welcome, NewViewer!", "welcome to the hunt"]);
    setTimeout(() => alienCommand("viewer", `!${command(GAME)}`), 4200);
  };
  setTimeout(demo, 1500);
  setInterval(demo, 10_000);
}
