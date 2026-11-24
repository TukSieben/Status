// Full-screen badge view for one game (default DOOM: The Dark Ages) in a dark-iron and ember look.
// Shows the game's badges big (one badge → a large hero card), how to get them, how rare they are and a countdown.
import { startChatEcho, avatarOf } from "../lib/chat-echo.js?v=7";
import { startPixelAlien } from "../lib/pixel-alien.js?v=7";
import { startMeme } from "../lib/meme.js?v=1";
import { startHunters } from "../lib/hunters.js?v=1";
import { startFollowGoal } from "../lib/follow-goal.js?v=1";
import { startLiveTag } from "../lib/live-tag.js?v=5";
import { $, el, badgeImg, loadBadges, watchBadges, reloadOnUpdate } from "../lib/utils.js";

const params = new URLSearchParams(location.search);
const GAME = (params.get("game") || "DOOM: The Dark Ages").trim();
const SHOW_PAID = params.get("paid") !== "0";
const MOTION = params.get("motion") !== "0";
if (MOTION) document.body.classList.add("dm-motion");
let badges = [];

function fit() {
  $("stage").style.transform = `scale(${Math.min(innerWidth / 1920, innerHeight / 1080)})`;
}
addEventListener("resize", fit);
fit();

const base = (t) => String(t || "").replace(/\s*\((subscribe|watch|sub)\)\s*$/i, "").trim().toLowerCase();
const isSub = (b) => /subscri|gift/i.test(b.objective || "") || /\((subscribe|sub)\)/i.test(`${b.game} ${b.eventName}`) || (!b.objective && b.cost === "paid");
const watchTime = (b) => String(b.objective || "").match(/^watch\s+(.+?)\s+in\s/i)?.[1] || null;
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

/** Chat command like the bot names it: "DOOM: The Dark Ages" → DOOM, "Grand Theft Auto VI" → GTA6 */
function command(game) {
  const colon = /^([A-Za-z0-9]{3,}):/.exec(game)?.[1];
  if (colon) return colon.toUpperCase();
  const words = game.toUpperCase().match(/[A-Z0-9]+/g) || [];
  const roman = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
  const last = words[words.length - 1];
  const num = roman[last] ? String(roman[last]) : /^\d+$/.test(last || "") ? last : "";
  const head = num ? words.slice(0, -1) : words;
  return head.length >= 2 ? head.map((w) => w[0]).join("") + num : (head[0] || "").slice(0, 3);
}
const CMD = (params.get("cmd") || command(GAME)).replace(/^!/, "").toUpperCase();

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

/** "Subscribe (Tier 1) or Gift 1 Tier 1 Sub in DOOM: …" → short how-to line */
function howTo(b) {
  if (isSub(b)) return "Sub (Tier 1) or gift 1 sub";
  const t = watchTime(b);
  return t ? `Watch ${pretty(t)}` : "Watch to earn";
}

/** The badge's own name — or, when it is just the game's name, what it celebrates ("…launch of Slaughter Mode" → Slaughter Mode) */
function heroName(b) {
  if (base(b.title) !== GAME.toLowerCase()) return b.title;
  const event = String(b.description || "").match(/launch of ([^.!,]{3,40})/i)?.[1]?.trim();
  return event || "Limited badge";
}

let lastKey = "";
function render() {
  const now = Date.now();
  const list = gameBadges(now);
  const live = list.filter((x) => Number.isNaN(x.start) || x.start <= now);
  const shown = (live.length ? live : list).filter((x) => SHOW_PAID || !isSub(x.b));
  const upcoming = !live.length && list.length > 0;

  // countdown
  const target = upcoming ? Math.min(...shown.map((x) => x.start)) : Math.min(...shown.map((x) => x.end));
  $("dmClockLabel").textContent = !shown.length ? "No badges" : upcoming ? "Starts in" : "Ends in";
  const clock = $("dmClock");
  const text = shown.length ? rel(target) : "—";
  if (clock.textContent !== text) {
    clock.textContent = text;
    if (MOTION) replay(clock, "is-tick");
  }
  $("dmDate").textContent = shown.length ? dateText(target) : "";

  const key = shown.map((x) => `${x.b.setID}:${x.b.userCount}`).join(",") + upcoming;
  if (key === lastKey) return;
  lastKey = key;

  $("dmTitle").textContent = GAME;
  const free = shown.filter((x) => !isSub(x.b));
  const paid = shown.filter((x) => isSub(x.b));
  const order = [...free, ...paid];
  $("stage").querySelector(".dm-kicker").textContent = order.length === 1 ? "Twitch badge" : "Twitch badges";

  // hero: one badge big, several as a grid
  const hero = $("dmHero");
  hero.classList.toggle("is-grid", order.length > 1);
  if (!order.length) {
    hero.replaceChildren(el("div", "dm-empty", "No active badges right now"));
  } else if (order.length === 1) {
    const b = order[0].b;
    const sigil = el("div", "dm-sigil");
    sigil.append(el("span", "dm-sigil-ring"), badgeImg(b, "dm-hero-img", 4));
    const info = el("div", "dm-hero-info");
    const tag = el("div", "dm-tags");
    tag.append(el("span", isSub(b) ? "dm-tag is-sub" : "dm-tag is-free", isSub(b) ? "Sub badge" : "Free badge"), el("span", "dm-tag", "Limited"));
    const how = el("p", "dm-hero-how");
    how.append(isSub(b) ? "Subscribe " : "Watch ", el("b", "", isSub(b) ? "Tier 1" : pretty(watchTime(b)) || "any stream"), isSub(b) ? " or " : "", ...(isSub(b) ? [el("b", "", "gift one sub"), ` to any ${GAME} streamer.`] : [` of ${GAME}.`]));
    info.append(tag, el("h2", "dm-hero-name", heroName(b)), how, el("div", "dm-hero-line", howTo(b)));
    hero.replaceChildren(sigil, info);
  } else {
    const grid = el("div", "dm-cards");
    grid.append(
      ...order.map((x) => {
        const c = el("div", "dm-card");
        c.append(badgeImg(x.b, "", 4), el("div", "dm-card-name", x.b.title), el("div", "dm-card-how", howTo(x.b)));
        return c;
      })
    );
    hero.replaceChildren(el("h2", "dm-h2", free.length && paid.length ? "Badges" : paid.length ? "Sub badges" : "Free badges"), grid);
  }

  // steps
  const subSteps = [
    ["Open any ", el("b", "", GAME), " stream on Twitch."],
    ["Subscribe ", el("b", "", "Tier 1"), " or ", el("b", "", "gift one sub"), " there."],
    ["The badge unlocks right away — ", el("b", "", "Prime doesn't count"), "."],
  ];
  const t = [...new Set(free.map((x) => watchTime(x.b)).filter(Boolean))];
  const watchSteps = [
    ["Watch any ", el("b", "", GAME), " stream for ", el("b", "", t.length === 1 ? pretty(t[0]) : "the required time"), "."],
    ["Stay logged in to Twitch while you watch."],
    ["Track your progress at ", el("b", "", "twitch.tv/drops/inventory"), "."],
  ];
  const steps = free.length ? watchSteps : subSteps;
  $("dmSteps").replaceChildren(
    ...steps.map((parts) => {
      const li = el("li");
      const span = el("span");
      span.append(...parts);
      li.append(span);
      return li;
    })
  );

  // rarity: how many people have it so far
  const rare = $("dmRare");
  const counted = order.filter((x) => Number(x.b.userCount) > 0);
  if (counted.length) {
    const top = counted.reduce((a, x) => (Number(x.b.userCount) < Number(a.b.userCount) ? x : a));
    const n = Number(top.b.userCount);
    const num = el("div", "dm-rare-num", n.toLocaleString("en-US"));
    const label = el("div", "dm-rare-label", counted.length > 1 ? `have ${top.b.title} so far` : "viewers have it so far");
    const tier = n < 5000 ? "Very rare" : n < 50000 ? "Rare" : "Common";
    rare.replaceChildren(el("h2", "dm-h2", "Rarity"), el("div", "dm-rare-tier", tier), num, label);
    rare.hidden = false;
  } else rare.hidden = true;

  const foot = el("div");
  foot.append("Type ", el("b", "", `!${CMD}`), " in chat for details");
  $("dmCmd").replaceChildren(foot);
}

/* ---------- motion: short moves now and then, still in between (cheap for the server stream) ---------- */
function replay(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}
// embers: a handful of sparks that rise during a short burst every few seconds
const embers = $("dmEmbers");
for (let i = 0; i < 10; i++) {
  const e = el("i");
  e.style.left = `${6 + ((i * 89) % 88)}%`;
  e.style.setProperty("--d", `${(i % 6) * 0.35}s`);
  e.style.setProperty("--x", `${((i * 37) % 60) - 30}px`);
  e.style.setProperty("--s", `${3 + (i % 3)}px`);
  embers.append(e);
}
if (MOTION) {
  // calm: every frame that changes costs server CPU, so moves are short and rare
  setInterval(() => replay(embers, "is-burst"), 40000);
  setInterval(() => replay($("dmTitle"), "is-shine"), 45000);
  setInterval(() => document.querySelector(".dm-sigil") && replay(document.querySelector(".dm-sigil"), "is-pulse"), 25000);
  setTimeout(() => replay(embers, "is-burst"), 1200);
  setTimeout(() => replay($("dmTitle"), "is-shine"), 2200);
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

/* chat bubbles, top hunters, follower goal, alien — in ember colors */
const stage = $("stage");
stage.style.setProperty("--echo-bg", "rgba(16, 9, 7, 0.94)");
stage.style.setProperty("--echo-border", "rgba(255, 122, 46, 0.4)");
stage.style.setProperty("--echo-accent", "#ff8a3d");
let goalBox = null;
const hunters = startHunters($("dmHunters"), { avatarOf });
const alien = startPixelAlien(stage, { left: 1090, top: 800, size: 96, accent: "#ff8a3d", bg: "rgba(16, 9, 7, .95)", text: "#fff2dc", bubble: "left" });
function alienCommand(name, cmd) {
  if (!alien) return;
  const mine = cmd && cmd.slice(1).toUpperCase().startsWith(CMD);
  alien.hop(mine ? ["Sub or gift 1", "→ badge unlocks"] : ["Good luck!", name]);
}
const echo = startChatEcho(stage, {
  position: { right: 76, bottom: 112 },
  getBadges: () => badges,
  onFollow: (name) => { goalBox?.bump(); alien?.cheer(["Welcome!", name]); },
  onCommand: (name, login, cmd) => { hunters?.add(name, login); alienCommand(name, cmd); },
});
goalBox = startFollowGoal($("dmGoal"), { onMilestone: (m) => echo?.celebrate(`${m.toLocaleString("en-US")} followers`) });

startLiveTag(stage);

if (alien && params.get("aliendemo") === "1") {
  const demo = () => {
    alien.cheer(["Welcome!", "NewViewer"]);
    setTimeout(() => alienCommand("viewer", `!${CMD}`), 4200);
  };
  setTimeout(demo, 1500);
  setInterval(demo, 10_000);
}

/* Meme clip (MEME_DOOM in the server's .env): ffmpeg draws it at stage x 40, y 116, 1536 × 864 (stream.js MEME_SLOT) */
startMeme($("dmMeme"), CMD, (on) => stage.classList.toggle("has-meme", on));
