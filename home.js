import { CHANNEL_URL, fetchChannel, earnableOnStream, playerSrc, chatSrc, paintLiveIndicators } from "./twitch.js";
import { renderSchedule, buildEvents } from "./schedule.js";

const URGENT_MS = 48 * 60 * 60 * 1000;
const $ = (id) => document.getElementById(id);

let badges = [];
let channel = null;

function img(b) {
  return b.image4x || b.image2x || b.image1x || "";
}

function onImgError(e) {
  const node = e.currentTarget;
  const src = node.src;
  if (src.endsWith("/3")) node.src = src.slice(0, -2) + "/2";
  else if (src.endsWith("/2")) node.src = src.slice(0, -2) + "/1";
}

function statusOf(b, now = Date.now()) {
  const end = Date.parse(b.endAt || "");
  if (Number.isNaN(end) || end <= now) return "ended";
  const start = Date.parse(b.startAt || "");
  if (!Number.isNaN(start) && start > now) return "upcoming";
  return "active";
}

function countdown(targetMs) {
  const diff = targetMs - Date.now();
  if (diff <= 0) return "0h 00m 00s";
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff / 3_600_000) % 24);
  const m = Math.floor((diff / 60_000) % 60);
  const s = Math.floor((diff / 1000) % 60);
  const pad = (n) => String(n).padStart(2, "0");
  return d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
}

function formatDate(iso) {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function compactNumber(n) {
  if (typeof n !== "number") return "";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function objectiveText(b) {
  return b.objective?.trim() || b.description?.trim() || "Unlock details not announced yet.";
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function badgeImg(b, className) {
  const image = el("img", className);
  image.src = img(b);
  image.alt = b.title;
  image.loading = "lazy";
  image.addEventListener("error", onImgError);
  return image;
}

function costPill(b) {
  return b.cost === "paid" ? el("span", "pill pill-paid", "Paid") : el("span", "pill pill-free", "Free");
}

function timerSpan(targetMs, extra = "") {
  const span = el("span", `timer ${extra}`.trim(), countdown(targetMs));
  span.dataset.target = String(targetMs);
  return span;
}

function getLists() {
  const now = Date.now();
  const active = [];
  const upcoming = [];
  const seen = new Set();
  for (const b of badges) {
    if (seen.has(b.setID)) continue;
    const s = statusOf(b, now);
    if (s === "ended") continue;
    seen.add(b.setID);
    (s === "active" ? active : upcoming).push(b);
  }
  return { active, upcoming };
}

function miniRow(b, mode) {
  const target = Date.parse(mode === "ending" ? b.endAt : b.startAt);
  const urgent = mode === "ending" && target - Date.now() < URGENT_MS;

  const row = el("a", "mini-row");
  row.href = `badge.html?id=${encodeURIComponent(b.setID)}`;

  const text = el("div", "row-text");
  text.append(el("div", "row-title", b.title), el("div", "row-objective", objectiveText(b)));

  const side = el("div", "mini-side");
  if (mode === "ending" && earnableOnStream(b, channel)) side.appendChild(el("span", "pill pill-live", "On stream"));
  side.append(costPill(b), timerSpan(target, urgent ? "is-urgent" : ""));

  row.append(badgeImg(b, "row-img"), text, side);
  return row;
}

function newestCard(b) {
  const endMs = Date.parse(b.endAt);
  const urgent = endMs - Date.now() < URGENT_MS;

  const card = el("a", "card");
  card.href = `badge.html?id=${encodeURIComponent(b.setID)}`;

  const status = el("div", "card-status pills");
  status.appendChild(el("span", "pill pill-soon pill-upper", "New"));

  const title = el("div", "card-title", b.title);
  const objective = el("p", "card-objective", objectiveText(b));

  const foot = el("div", "card-foot");
  const tags = el("div", "pills");
  tags.appendChild(costPill(b));
  if (earnableOnStream(b, channel)) tags.appendChild(el("span", "pill pill-live", "On stream"));
  const meta = el("div", "card-meta");
  meta.append(el("span", "", "Ends in"), el("span", "users", b.userCount != null ? `${compactNumber(b.userCount)} users` : ""));
  foot.append(tags, meta, timerSpan(endMs, urgent ? "is-urgent" : ""));

  card.append(status, badgeImg(b, "card-img"), title, objective, foot);
  return card;
}

function emptyNote(text) {
  return el("div", "mini-empty", text);
}

function render() {
  const { active, upcoming } = getLists();

  $("hsActive").textContent = String(active.length);
  $("hsUpcoming").textContent = String(upcoming.length);
  $("hsFree").textContent = String(active.filter((b) => b.cost !== "paid").length);
  $("hsTotal").textContent = String(new Set(badges.map((b) => b.setID)).size);
  $("heroLive").textContent = `${active.length} badges available right now`;

  // Hero showcase: a floating wall of current badge images
  const showcase = $("heroShowcase");
  const wall = [...active, ...upcoming].slice(0, 12);
  showcase.replaceChildren(
    ...wall.map((b, i) => {
      const tile = el("div", "show-tile");
      tile.style.animationDelay = `${(i % 6) * 0.35}s`;
      tile.appendChild(badgeImg(b, ""));
      return tile;
    })
  );
  showcase.classList.toggle("hidden", wall.length === 0);

  const ending = active.slice().sort((a, b) => Date.parse(a.endAt) - Date.parse(b.endAt)).slice(0, 5);
  $("endingList").replaceChildren(...(ending.length ? ending.map((b) => miniRow(b, "ending")) : [emptyNote("No active badge drops right now.")]));

  const starting = upcoming.slice().sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)).slice(0, 5);
  $("startingList").replaceChildren(...(starting.length ? starting.map((b) => miniRow(b, "starting")) : [emptyNote("No upcoming badges announced yet.")]));

  const newest = active.slice().sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt)).slice(0, 6);
  $("newestCount").textContent = `(${newest.length})`;
  $("newestGrid").replaceChildren(...newest.map(newestCard));
}

function renderStream() {
  paintLiveIndicators(channel);
  const live = Boolean(channel?.live);

  const badge = $("liveBadge");
  badge.textContent = live ? "Live" : "Offline";
  badge.classList.toggle("is-live", live);
  $("streamViewers").textContent = live ? `${channel.viewers.toLocaleString("en-US")} watching` : "";
  if (live && channel.title) $("streamTitle").textContent = channel.title;

  $("streamGameWrap").classList.toggle("hidden", !(live && channel.game));
  $("streamGame").textContent = channel?.game || "";

  const { active } = getLists();
  const earnable = active.filter((b) => earnableOnStream(b, channel));
  $("streamEarnWrap").classList.toggle("hidden", earnable.length === 0);
  $("streamEarnList").replaceChildren(
    ...earnable.map((b) => {
      const chip = el("a", "earn-chip");
      chip.href = `badge.html?id=${encodeURIComponent(b.setID)}`;
      chip.title = objectiveText(b);
      chip.append(badgeImg(b, ""), el("span", "", b.title));
      return chip;
    })
  );

}

function embedTwitch() {
  const player = document.createElement("iframe");
  player.src = playerSrc();
  player.allowFullscreen = true;
  player.title = "BadgeStatus Twitch stream";
  player.setAttribute("allow", "autoplay; fullscreen");
  $("playerFrame").replaceChildren(player);

  const chat = document.createElement("iframe");
  chat.src = chatSrc();
  chat.title = "BadgeStatus Twitch chat";
  $("chatFrame").replaceChildren(chat);
}

function drawSchedule() {
  renderSchedule($("scheduleRoot"), badges, { href: (ev) => `badge.html?id=${encodeURIComponent(ev.badges[0].setID)}` });
  $("schedCount").textContent = `(${buildEvents(badges).length})`;
}

async function refreshChannel() {
  const next = await fetchChannel();
  if (next) channel = next;
  renderStream();
  render();
}

function tick() {
  for (const node of document.querySelectorAll("[data-target]")) {
    node.textContent = countdown(Number(node.dataset.target));
  }
  const { active, upcoming } = getLists();
  if (active.length !== Number($("hsActive").textContent) || upcoming.length !== Number($("hsUpcoming").textContent)) {
    render();
  }
}

$("homeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const login = $("homeInput").value.trim().toLowerCase().replace(/^@/, "").replace(/^.*twitch\.tv\//, "").replace(/[/?#].*$/, "");
  location.href = login ? `badges.html?user=${encodeURIComponent(login)}` : "badges.html";
});

try {
  const saved = localStorage.getItem("badgestatus_user");
  if (saved) {
    $("homeInput").value = saved;
    $("homeHint").textContent = `Welcome back, ${saved}.`;
  }
} catch {}

async function init() {
  try {
    const res = await fetch("./data/badges.json", { cache: "no-cache" });
    if (res.ok) {
      const doc = await res.json();
      badges = doc.badges || [];
      $("footerSync").textContent = doc.syncedAt ? `Schedule synced ${formatDate(doc.syncedAt)}` : "";
    }
  } catch {}
  embedTwitch();
  render();
  drawSchedule();
  renderStream();
  setInterval(tick, 1000);
  refreshChannel();
  setInterval(refreshChannel, 60_000);
}

init();
