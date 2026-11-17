// Gameplay overlay: badge sidebar with bot commands and live times. Updates itself.
import { $, el, badgeImg, loadBadges, watchBadges } from "../lib/utils.js";

const params = new URLSearchParams(location.search);
const EXPIRED_DAYS = params.has("expired") ? Number(params.get("expired")) || 0 : 3;
const GAME = (params.get("game") || "").trim().toLowerCase();
if (params.get("side") === "right") $("stage").classList.add("is-right");
if (params.get("brand") === "0") $("sbBrand").classList.add("hidden");

let badges = [];

/* ---------- fixed 1920×1080 stage ---------- */
function fit() {
  $("stage").style.transform = `scale(${Math.min(innerWidth / 1920, innerHeight / 1080)})`;
}
addEventListener("resize", fit);
fit();

/* ---------- helpers ---------- */

/** Chat command as typed: "Welcome 2 Miami" -> "!Welcome2Miami" (the bot ignores case) */
function command(b) {
  const words = String(b.title).normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[A-Za-z0-9]+/g) || [b.setID];
  return "!" + words.map((w) => (w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1))).join("");
}

function dur(ms) {
  const diff = Math.max(0, ms);
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff / 3_600_000) % 24);
  const m = Math.floor((diff / 60_000) % 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

function entries(now = Date.now()) {
  const bySet = new Map();
  for (const b of badges) {
    const prev = bySet.get(b.setID);
    if (!prev || Number(b.version) > Number(prev.version)) bySet.set(b.setID, b);
  }
  const list = [];
  for (const b of bySet.values()) {
    if (GAME && !`${b.game || ""} ${b.objective || ""} ${b.eventName || ""}`.toLowerCase().includes(GAME)) continue;
    const start = Date.parse(b.startAt || "");
    const end = Date.parse(b.endAt || "");
    if (Number.isNaN(end)) continue;
    if (end > now && (Number.isNaN(start) || start <= now)) list.push({ b, state: "active", t: end });
    else if (start > now) list.push({ b, state: "upcoming", t: start });
    else if (EXPIRED_DAYS > 0 && now - end < EXPIRED_DAYS * 86_400_000) list.push({ b, state: "expired", t: end });
  }
  const order = { active: 0, upcoming: 1, expired: 2 };
  return list.sort((x, y) => order[x.state] - order[y.state] || (x.state === "expired" ? y.t - x.t : x.t - y.t));
}

function item({ b, state, t }) {
  const row = el("div", `sb-item is-${state}`);
  row.dataset.state = state;
  row.dataset.t = String(t);
  const text = el("div", "sb-text");
  const st = el("div", "sb-state");
  text.append(el("div", "sb-cmd", command(b)), st);
  row.append(badgeImg(b, "", 4), text);
  paint(row);
  return row;
}

function paint(row) {
  const st = row.querySelector(".sb-state");
  const t = Number(row.dataset.t);
  const now = Date.now();
  if (row.dataset.state === "active") st.replaceChildren("Available for: ", el("b", "", dur(t - now)));
  else if (row.dataset.state === "upcoming") st.replaceChildren("Starts in: ", el("b", "", dur(t - now)));
  else st.textContent = "Time expired";
}

/* ---------- render ---------- */

let lastKey = "";
function render() {
  const list = entries();
  const key = list.map((e) => `${e.b.setID}:${e.state}`).join(",");
  if (key === lastKey) return; // nothing moved between groups → keep the scroll animation running
  lastKey = key;

  const track = $("sbTrack");
  track.classList.remove("is-scrolling");
  track.style.animationDuration = "";
  if (!list.length) {
    track.replaceChildren(el("div", "sb-empty", "No badges right now."));
    return;
  }
  track.replaceChildren(...list.map(item));

  // Too many to fit → duplicate the list and scroll it slowly in a loop
  requestAnimationFrame(() => {
    const fits = track.scrollHeight <= $("sbScroll").clientHeight;
    if (fits) return;
    track.append(...list.map(item));
    track.classList.add("is-scrolling");
    track.style.animationDuration = `${list.length * 3.2}s`; // ~3 s per badge
  });
}

function tick() {
  for (const row of document.querySelectorAll(".sb-item")) paint(row);
  render(); // regroups when a badge starts or ends
}

const data = await loadBadges();
badges = data.badges;
render();
setInterval(tick, 20_000); // minutes-precision text: refreshing every 20 s is plenty
watchBadges(
  (next) => {
    badges = next.badges;
    lastKey = "";
    render();
  },
  { syncedAt: data.syncedAt, intervalMs: 60_000 }
);
