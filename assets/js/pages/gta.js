// Full-screen badge view for one game (default GTA VI): free badges with how to get them, sub badges, countdown.
import { startDaylight, setVars } from "../lib/daylight.js?v=1";
import { startChatEcho, avatarOf } from "../lib/chat-echo.js?v=7";
import { startPixelAlien } from "../lib/pixel-alien.js?v=7";
import { startMeme } from "../lib/meme.js?v=1";
import { startHunters } from "../lib/hunters.js?v=1";
import { startFollowGoal } from "../lib/follow-goal.js?v=1";
import { startLiveTag } from "../lib/live-tag.js?v=5";
import { $, el, badgeImg, loadBadges, watchBadges, reloadOnUpdate } from "../lib/utils.js";

const params = new URLSearchParams(location.search);
const GAME = (params.get("game") || "Grand Theft Auto VI").trim();
const SHOW_PAID = params.get("paid") !== "0";
const MOTION = params.get("motion") !== "0";
if (MOTION) document.body.classList.add("vc-motion");
let badges = [];

function fit() {
  $("stage").style.transform = `scale(${Math.min(innerWidth / 1920, innerHeight / 1080)})`;
}
addEventListener("resize", fit);
fit();

const base = (t) => String(t || "").replace(/\s*\((subscribe|watch|sub)\)\s*$/i, "").trim().toLowerCase();
const isSub = (b) => /subscri|gift/i.test(b.objective || "") || /\((subscribe|sub)\)/i.test(`${b.game} ${b.eventName}`) || (!b.objective && b.cost === "paid");
const watchTime = (b) => String(b.objective || "").match(/^watch\s+(.+?)\s+in\s/i)?.[1] || null;
/** "watching 3 days of …" → 3 */
const days = (b) => Number(String(b.description || "").match(/watching\s+(\d+)\s+days?/i)?.[1] || 0);
const pretty = (t) => (t || "").replace(/^(\d+)h$/, (_, h) => `${h} hour${h === "1" ? "" : "s"}`).replace(/^(\d+)m$/, "$1 min");

function rel(ms) {
  const diff = Math.max(0, ms - Date.now());
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff / 3_600_000) % 24);
  const m = Math.floor((diff / 60_000) % 60);
  return d > 0 ? `${d}d ${h}h ${String(m).padStart(2, "0")}m` : `${h}h ${String(m).padStart(2, "0")}m`;
}
const dateText = (ms) =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";

/** Same short command as the bot: "Grand Theft Auto VI" → GTA6 */
function alias(game) {
  const words = game.toUpperCase().match(/[A-Z0-9]+/g) || [];
  const roman = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
  const last = words[words.length - 1];
  const num = roman[last] ? String(roman[last]) : /^\d+$/.test(last || "") ? last : "";
  const head = num ? words.slice(0, -1) : words;
  return head.length >= 2 ? head.map((w) => w[0]).join("") + num : (head[0] || "").slice(0, 3);
}

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

let lastKey = "";
function render() {
  const now = Date.now();
  const list = gameBadges(now);
  const live = list.filter((x) => Number.isNaN(x.start) || x.start <= now);
  const shown = live.length ? live : list;
  const upcoming = !live.length && list.length > 0;
  const free = shown.filter((x) => !isSub(x.b)).sort((a, b) => days(a.b) - days(b.b) || a.b.title.localeCompare(b.b.title));
  const paid = shown.filter((x) => isSub(x.b));

  // countdown
  const target = upcoming ? Math.min(...shown.map((x) => x.start)) : Math.min(...shown.map((x) => x.end));
  $("vcClockLabel").textContent = !shown.length ? "No badges" : upcoming ? "Starts in" : "Ends in";
  const clock = $("vcClock");
  const text = shown.length ? rel(target) : "—";
  if (clock.textContent !== text) {
    clock.textContent = text;
    if (MOTION) {
      clock.classList.remove("is-tick");
      void clock.offsetWidth; // restart the animation
      clock.classList.add("is-tick");
    }
  }
  $("vcDate").textContent = shown.length ? dateText(target) : "";

  const key = shown.map((x) => x.b.setID).join(",") + upcoming;
  if (key === lastKey) return;
  lastKey = key;

  $("vcTitle").textContent = GAME;
  const time = [...new Set(free.map((x) => watchTime(x.b)).filter(Boolean))];
  const daily = free.some((x) => days(x.b) > 0);
  $("vcFreeHead").textContent = free.length ? "Free badges" : "No free badges";
  $("vcFreePill").textContent = time.length === 1 ? `Watch ${pretty(time[0])}${daily ? " a day" : ""}` : "Watch to earn";
  $("vcFreePill").hidden = !free.length;

  $("vcCards").replaceChildren(
    ...free.map((x) => {
      const c = el("div", "vc-card");
      const d = days(x.b);
      const t = watchTime(x.b);
      c.append(
        badgeImg(x.b, "", 4),
        el("div", "vc-card-name", x.b.title),
        el("div", "vc-card-step", d ? `Day ${d}` : "Free"),
        el("div", "vc-card-how", d ? `${t ? pretty(t) : "Watch"} on ${d} day${d === 1 ? "" : "s"}` : t ? `Watch ${pretty(t)}` : "")
      );
      return c;
    })
  );

  // steps
  const t = time.length === 1 ? pretty(time[0]) : "the required time";
  const steps = daily
    ? [
        ["Watch any ", el("b", "", `${GAME}`), ` stream for `, el("b", "", t), "."],
        ["Come back the next day and watch again — ", el("b", "", "every day unlocks the next chain"), "."],
        ["Track your progress at ", el("b", "", "twitch.tv/drops/inventory"), "."],
      ]
    : [
        ["Watch any ", el("b", "", GAME), " stream for ", el("b", "", t), "."],
        ["Stay logged in to Twitch while you watch."],
        ["Track your progress at ", el("b", "", "twitch.tv/drops/inventory"), "."],
      ];
  $("vcSteps").replaceChildren(
    ...steps.map((parts) => {
      const li = el("li");
      const span = el("span");
      span.append(...parts);
      li.append(span);
      return li;
    })
  );

  // sub badges: those you get with a sub, and "collect them all" ones
  const subs = paid.filter((x) => /subscri|gift/i.test(x.b.objective || ""));
  const others = paid.filter((x) => !subs.includes(x));
  const rows = [];
  if (subs.length) {
    const icons = el("div", "vc-paid-icons");
    icons.append(...subs.map((x) => badgeImg(x.b, "", 2)));
    const text = el("div", "vc-paid-text");
    const n = subs.length;
    const how =
      n > 1
        ? `Each new sub or gift sub to a ${GAME} streamer unlocks one — ${n} subs for all ${n}. Prime doesn't count.`
        : `Subscribe or gift a sub to a ${GAME} streamer. Prime doesn't count.`;
    text.append(el("b", "", subs.map((x) => x.b.title).join(", ")), how);
    const row = el("div", "vc-paid-row");
    row.append(icons, text);
    rows.push(row);
  }
  for (const x of others) {
    const icons = el("div", "vc-paid-icons");
    icons.append(badgeImg(x.b, "", 2));
    const text = el("div", "vc-paid-text");
    const how = /all the emotes and badges/i.test(x.b.description || "") ? "Collect every badge and emote of the launch" : x.b.description || "See badgestatus.net";
    text.append(el("b", "", x.b.title), how.replace(/\.$/, ""));
    const row = el("div", "vc-paid-row");
    row.append(icons, text);
    rows.push(row);
  }
  $("vcPaid").replaceChildren(...rows);
  $("vcPaidPanel").hidden = !SHOW_PAID || !rows.length;

  const cmd = alias(GAME);
  const hasWatchCampaign = free.some((x) => /\(watch\)\s*$/i.test(x.b.eventName || ""));
  const foot = el("div");
  foot.append("Type ", el("b", "", hasWatchCampaign ? `!${cmd}FREE` : `!${cmd}`));
  if (hasWatchCampaign && SHOW_PAID && paid.length) foot.append(" or ", el("b", "", `!${cmd}`));
  foot.append(" in chat for details");
  $("vcCmd").replaceChildren(foot);
}

/* ---------- motion: one short move every few seconds, nothing runs in between ---------- */
let spot = 0;
function moveSpot() {
  const cards = [...document.querySelectorAll(".vc-card")];
  cards.forEach((c) => c.classList.remove("is-spot"));
  if (!cards.length) return;
  spot = (spot + 1) % cards.length;
  cards[spot].classList.add("is-spot");
}
function replay(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}
if (MOTION) {
  setInterval(moveSpot, 15000); // spotlight walks Day 1 → Day 6 (calm: every frame that changes costs server CPU)
  setInterval(() => replay($("vcTitle"), "is-shine"), 40000); // light sweep over the title
  setInterval(() => document.querySelectorAll(".vc-palm").forEach((p) => replay(p, "is-sway")), 60000); // palms move
  setTimeout(() => replay($("vcTitle"), "is-shine"), 1800);
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

/* Day & night over Vice City: night sky with a faint moon-sun, soft dawn, bright day, golden-pink sunset */
startDaylight(
  [
    { h: 0, v: { s1: "#070a1f", s2: "#0f1238", s3: "#1c1650", s4: "#2c1a5a", s5: "#3b1d5c", sun: 0.14, palm: "#05040f" } },
    { h: 6, v: { s1: "#1a1440", s2: "#3b2a6b", s3: "#7a4a8a", s4: "#e08a9a", s5: "#ffc48a", sun: 0.42, palm: "#120a24" } },
    { h: 12, v: { s1: "#26357e", s2: "#4048a6", s3: "#6c5ec0", s4: "#b884cc", s5: "#ffb4a2", sun: 0.32, palm: "#160c2c" } },
    { h: 18, v: { s1: "#1c0a35", s2: "#3d1259", s3: "#8a2a78", s4: "#e0517f", s5: "#ff9a5a", sun: 0.6, palm: "#140720" } },
    { h: 21, v: { s1: "#0f0a2c", s2: "#24104a", s3: "#4a1a62", s4: "#7a2a6e", s5: "#9a3a6a", sun: 0.26, palm: "#0a0518" } },
  ],
  (v) => setVars($("stage"), v)
);

/* Chat echo in the Vice-City colors */
$("stage").style.setProperty("--echo-bg", "rgba(24, 6, 40, 0.92)");
$("stage").style.setProperty("--echo-border", "rgba(255, 193, 220, 0.35)");
$("stage").style.setProperty("--echo-accent", "#ffc1dc");
let goalBox = null;
const hunters = startHunters($("vcHunters"), { avatarOf });
/* Pixel alien standing on the "How to get them" panel, between the title and the clock */
const alien = startPixelAlien($("stage"), { left: 1330, top: 92, size: 96, accent: "#ffc1dc", bg: "rgba(20, 6, 36, .94)", text: "#ffffff", bubble: "right" });
function alienCommand(name, cmd) {
  if (!alien) return;
  const mine = cmd && cmd.slice(1).toLowerCase().startsWith(alias(GAME).toLowerCase());
  alien.hop(mine ? ["Watch 1h a day", "→ next chain each day"] : ["Good luck!", name]);
}
const echo = startChatEcho($("stage"), {
  position: { right: 76, bottom: 112 },
  getBadges: () => badges,
  onFollow: (name) => { goalBox?.bump(); alien?.cheer(["Welcome!", name]); },
  onCommand: (name, login, cmd) => { hunters?.add(name, login); alienCommand(name, cmd); },
});
goalBox = startFollowGoal($("vcGoal"), { onMilestone: (m) => echo?.celebrate(`${m.toLocaleString("en-US")} followers`) });

/* "THIS IS LIVE · NOT A VOD" strip at the bottom */
startLiveTag($("stage"));

/* ?aliendemo=1 → follow + command reactions every few seconds (to try it out) */
if (alien && params.get("aliendemo") === "1") {
  const demo = () => {
    alien.cheer(["Welcome!", "NewViewer"]);
    setTimeout(() => alienCommand("viewer", `!${alias(GAME)}`), 4200);
  };
  setTimeout(demo, 1500);
  setInterval(demo, 10_000);
}

/* Meme clip (MEME_GTA6 in the server's .env): biggest thing on screen, the badges move into a compact column.
   ffmpeg draws it at stage x 64, y 196, 1312 × 738 (stream.js MEME_SLOT) */
startMeme($("vcMeme"), alias(GAME), (on) => $("stage").classList.toggle("has-meme", on));
