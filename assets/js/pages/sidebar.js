// Gameplay overlay: floating badge panel — spotlight + paged list with bot commands. Updates itself.
import { $, el, badgeImg, loadBadges, watchBadges, onlyFree } from "../lib/utils.js";

const params = new URLSearchParams(location.search);
const EXPIRED_DAYS = params.has("expired") ? Number(params.get("expired")) || 0 : 3;
const GAME = (params.get("game") || "").trim().toLowerCase();
const PAGE_MS = 9000;
const SPOT_MS = 8000;
const URGENT = 48 * 3_600_000;
const ROW_H = 64;
const GROUP_H = 40;

if (params.get("side") === "right") $("stage").classList.add("is-right");
if (params.get("brand") === "0") $("sbBrand").replaceChildren(el("span", "", "Badges"));

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

const pad = (n) => String(n).padStart(2, "0");
function parts(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s / 3600) % 24), m: Math.floor((s / 60) % 60), s: s % 60 };
}
function short(ms) {
  const { d, h, m } = parts(ms);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${pad(m)}m` : `${m}m`;
}
function long(ms) {
  const { d, h, m, s } = parts(ms);
  return d > 0 ? `${d}d ${h}h ${pad(m)}m` : `${h}h ${pad(m)}m ${pad(s)}s`;
}
function ago(ms) {
  const { d, h, m } = parts(ms);
  return d > 0 ? `${d}d ago` : h > 0 ? `${h}h ago` : `${m}m ago`;
}
const gameOf = (b) => b.game || b.eventName || b.category || "";

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
    const e = { b, start, end };
    if (end > now && (Number.isNaN(start) || start <= now)) list.push({ ...e, state: "active" });
    else if (start > now) list.push({ ...e, state: "upcoming" });
    else if (EXPIRED_DAYS > 0 && now - end < EXPIRED_DAYS * 86_400_000) list.push({ ...e, state: "expired" });
  }
  const key = (e) => (e.state === "active" ? e.end : e.state === "upcoming" ? e.start : -e.end);
  const order = { active: 0, upcoming: 1, expired: 2 };
  return list.sort((x, y) => order[x.state] - order[y.state] || key(x) - key(y));
}

function bar(extra = "") {
  const b = el("div", `sb-bar ${extra}`.trim());
  b.append(el("span"));
  return b;
}

/** share of the window still left (1 = just started) */
function leftShare(e, now) {
  if (Number.isNaN(e.start) || e.end <= e.start) return 1;
  return Math.min(1, Math.max(0, (e.end - now) / (e.end - e.start)));
}

/* ---------- spotlight ---------- */

let spot = [];
let spotIdx = 0;

function spotPick(list) {
  const active = list.filter((e) => e.state === "active").slice(0, 5);
  if (active.length) return { label: "Ending soon", items: active };
  return { label: "Up next", items: list.filter((e) => e.state === "upcoming").slice(0, 3) };
}

function showSpot() {
  const wrap = $("sbSpot");
  if (!spot.length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  spotIdx %= spot.length;
  const e = spot[spotIdx];
  $("sbSpotIdx").textContent = spot.length > 1 ? `${spotIdx + 1} / ${spot.length}` : "";

  const tile = el("div", "sb-tile");
  tile.append(badgeImg(e.b, "", 4));
  const name = el("div", "");
  name.append(el("div", "sb-spot-cmd", command(e.b)), el("div", "sb-spot-game", gameOf(e.b) || e.b.title));
  const time = el("div", "sb-spot-time");
  time.append(el("div", "sb-spot-count"), el("div", "sb-spot-sub"));

  const body = el("div", "sb-spot-body");
  body.append(tile, name, time);
  if (e.state === "active") body.append(bar());
  $("sbSpotBody").replaceWith(body);
  body.id = "sbSpotBody";
  paintSpot();
}

function paintSpot(now = Date.now()) {
  const e = spot[spotIdx];
  const body = $("sbSpotBody");
  if (!e || !body) return;
  const count = body.querySelector(".sb-spot-count");
  const sub = body.querySelector(".sb-spot-sub");
  if (e.state === "active") {
    const urgent = e.end - now < URGENT;
    count.className = `sb-spot-count ${urgent ? "is-urgent" : "is-active"}`;
    count.textContent = long(e.end - now);
    sub.textContent = "left";
    const b = body.querySelector(".sb-bar");
    b.classList.toggle("is-urgent", urgent);
    b.firstChild.style.width = `${leftShare(e, now) * 100}%`;
  } else {
    count.className = "sb-spot-count is-upcoming";
    count.textContent = long(e.start - now);
    sub.textContent = "until start";
  }
}

/* ---------- paged list ---------- */

let pages = [];
let pageIdx = 0;

const GROUP_NAME = { active: "Live now", upcoming: "Up next", expired: "Just ended" };

function groupRow(state, count) {
  const g = el("div", `sb-group is-${state}`);
  const label = el("span", "sb-label");
  label.append(el("i"), GROUP_NAME[state], el("em", "", String(count)));
  g.append(label);
  return g;
}

function row(e) {
  const r = el("div", `sb-row is-${e.state}`);
  r.dataset.i = String(rowsData.push(e) - 1);
  const main = el("div", "sb-row-main");
  const meta = el("div", "sb-meta");
  if (e.state === "active") meta.append(bar(), el("span", "sb-t"));
  else meta.append(el("span", "sb-t"));
  main.append(el("div", "sb-cmd", command(e.b)), meta);
  r.append(badgeImg(e.b, "", 2), main);
  return r;
}
let rowsData = [];

function paintRows(now = Date.now()) {
  for (const r of document.querySelectorAll(".sb-row")) {
    const e = rowsData[Number(r.dataset.i)];
    const t = r.querySelector(".sb-t");
    if (e.state === "active") {
      r.classList.toggle("is-urgent", e.end - now < URGENT);
      t.textContent = short(e.end - now);
      r.querySelector(".sb-bar span").style.width = `${leftShare(e, now) * 100}%`;
    } else if (e.state === "upcoming") t.textContent = `Starts in ${short(e.start - now)}`;
    else t.textContent = `Ended ${ago(now - e.end)}`;
  }
}

function paginate(list) {
  const height = $("sbList").clientHeight - 6;
  const counts = { active: 0, upcoming: 0, expired: 0 };
  for (const e of list) counts[e.state]++;
  const out = [];
  let cur = [];
  let used = 0;
  let lastState = null;
  for (const e of list) {
    const needsHead = e.state !== lastState || cur.length === 0;
    const need = ROW_H + (needsHead ? GROUP_H : 0);
    if (used + need > height && cur.length) {
      out.push(cur);
      cur = [];
      used = 0;
    }
    if (e.state !== lastState || cur.length === 0) {
      cur.push({ head: e.state, count: counts[e.state] });
      used += GROUP_H;
    }
    cur.push(e);
    used += ROW_H;
    lastState = e.state;
  }
  if (cur.length) out.push(cur);
  return out;
}

function showPage() {
  const list = $("sbList");
  rowsData = [];
  if (!pages.length) {
    list.replaceChildren(el("div", "sb-empty", "No badges right now."));
    $("sbDots").replaceChildren();
    return;
  }
  pageIdx %= pages.length;
  const page = el("div", "sb-page");
  for (const it of pages[pageIdx]) page.append(it.head ? groupRow(it.head, it.count) : row(it));
  list.replaceChildren(page);
  paintRows();
  $("sbDots").replaceChildren(...(pages.length > 1 ? pages.map((_, i) => el("i", i === pageIdx ? "on" : "")) : []));
}

/* ---------- render loop ---------- */

let lastKey = "";
function render(force = false) {
  const list = entries();
  const key = list.map((e) => `${e.b.setID}:${e.state}`).join(",");
  if (key === lastKey && !force) return;
  lastKey = key;

  const live = list.filter((e) => e.state === "active").length;
  const liveEl = $("sbLive");
  liveEl.replaceChildren(el("i"), `${live} live`);

  const picked = spotPick(list);
  $("sbSpotLabel").textContent = picked.label;
  spot = picked.items;
  spotIdx = 0;
  showSpot();

  pages = paginate(list);
  pageIdx = 0;
  showPage();
}

const data = await loadBadges();
badges = onlyFree(data.badges);
render(true);

setInterval(() => { paintSpot(); paintRows(); }, 1000);
setInterval(() => render(), 20_000); // regroup when a badge starts or ends
setInterval(() => { if (spot.length > 1) { spotIdx++; showSpot(); } }, SPOT_MS);
setInterval(() => { if (pages.length > 1) { pageIdx++; showPage(); } }, PAGE_MS);
watchBadges(
  (next) => { badges = onlyFree(next.badges); render(true); },
  { syncedAt: data.syncedAt, intervalMs: 60_000 }
);
