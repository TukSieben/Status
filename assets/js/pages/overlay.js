// 1920×1080 stream overlay. No interaction — it just keeps itself up to date.
import { $, el, badgeImg, splitBadges, loadBadges, watchBadges, URGENT_MS } from "../lib/utils.js";
import { buildEvents } from "../lib/schedule.js";

const params = new URLSearchParams(location.search);
const ROTATE_MS = Math.max(5, Number(params.get("rotate")) || 15) * 1000;
const PER_PAGE = 12; // 4 × 3 cards

if (params.get("transparent") === "1") document.body.classList.add("is-transparent");

let badges = [];
let page = 0;

/* ---------- scale the fixed 1920×1080 stage to the window ---------- */

function fit() {
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  $("stage").style.transform = `scale(${scale})`;
}
window.addEventListener("resize", fit);
fit();

/* ---------- formatting ---------- */

function short(ms) {
  const diff = Math.max(0, ms - Date.now());
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff / 3_600_000) % 24);
  const m = Math.floor((diff / 60_000) % 60);
  const s = Math.floor((diff / 1000) % 60);
  const pad = (n) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Words for the ticker: "22h 49m", "1d 19h" */
function words(ms) {
  const diff = Math.max(0, ms - Date.now());
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff / 3_600_000) % 24);
  const m = Math.floor((diff / 60_000) % 60);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
}

function countdown(targetMs, className = "") {
  const span = el("span", `ov-timer ${className}`.trim(), short(targetMs));
  span.dataset.until = String(targetMs);
  return span;
}

/* ---------- sections ---------- */

function renderGrid(active) {
  const sorted = active.slice().sort((a, b) => Date.parse(a.endAt) - Date.parse(b.endAt));
  const pages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  page %= pages;

  const slice = sorted.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  $("oGrid").replaceChildren(
    ...slice.map((b) => {
      const end = Date.parse(b.endAt);
      const card = el("div", "ov-card");
      const paid = b.cost === "paid";
      const meta = el("div", "ov-card-meta");
      meta.append(
        el("span", `ov-tag ${paid ? "is-paid" : "is-free"}`, paid ? "Paid" : "Free"),
        countdown(end, end - Date.now() < URGENT_MS ? "is-urgent" : "")
      );
      card.append(badgeImg(b, "ov-card-img"), el("div", "ov-card-title", b.title), meta);
      return card;
    })
  );
  if (!slice.length) $("oGrid").appendChild(el("div", "ov-empty", "No badges available right now."));

  $("oDots").replaceChildren(...Array.from({ length: pages > 1 ? pages : 0 }, (_, i) => el("span", i === page ? "is-on" : "")));
}

/** "Grand Theft Auto VI (Subscribe)" + "... (Watch)" starting together → one "Grand Theft Auto VI" drop. */
function nextDrop() {
  const upcoming = buildEvents(badges).filter((e) => e.upcoming);
  if (!upcoming.length) return null;
  const base = (name) => name.replace(/\s*\((subscribe|sub|watch)\)$/i, "");
  const first = upcoming[0];
  const same = upcoming.filter((e) => e.start === first.start && base(e.name) === base(first.name));
  return { name: base(first.name), start: first.start, badges: same.flatMap((e) => e.badges) };
}

function renderNext() {
  const next = nextDrop();
  $("oNext").classList.toggle("is-empty", !next);
  if (!next) {
    $("oNextName").textContent = "Nothing announced yet";
    $("oNextIcons").replaceChildren();
    $("oNextCount").replaceChildren();
    $("oNextDate").textContent = "";
    return;
  }
  $("oNextName").textContent = next.name;
  $("oNextName").dataset.count = `${next.badges.length} badge${next.badges.length === 1 ? "" : "s"}`;
  $("oNextIcons").replaceChildren(...next.badges.slice(0, 8).map((b) => badgeImg(b, "", 4)));
  $("oNextCount").replaceChildren(countdown(next.start));
  $("oNextDate").textContent = new Date(next.start).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

function renderEnding(active) {
  const ending = active.slice().sort((a, b) => Date.parse(a.endAt) - Date.parse(b.endAt)).slice(0, 5);
  $("oEnding").replaceChildren(
    ...ending.map((b) => {
      const end = Date.parse(b.endAt);
      const row = el("div", "ov-row");
      row.append(badgeImg(b, "ov-row-img", 2), el("span", "ov-row-title", b.title), countdown(end, end - Date.now() < URGENT_MS ? "is-urgent" : ""));
      return row;
    })
  );
}

function renderTicker(active, upcoming) {
  const items = [
    ...active
      .slice()
      .sort((a, b) => Date.parse(a.endAt) - Date.parse(b.endAt))
      .slice(0, 8)
      .map((b) => `${b.title} ends in ${words(Date.parse(b.endAt))}`),
    ...upcoming.slice(0, 6).map((b) => `${b.title} starts in ${words(Date.parse(b.startAt))}`),
  ];
  const text = items.join("   ·   ");
  // Two copies so the marquee loops seamlessly
  const track = $("oTicker");
  track.replaceChildren(el("span", "", text), el("span", "", text));
  track.style.animationDuration = `${Math.max(30, text.length * 0.22)}s`;
}

function renderAll() {
  const { active, upcoming } = splitBadges(badges);
  $("oActive").textContent = String(active.length);
  $("oUpcoming").textContent = String(upcoming.length);
  renderGrid(active);
  renderNext();
  renderEnding(active);
  renderTicker(active, upcoming);
}

/* ---------- clocks ---------- */

function tick() {
  const now = new Date();
  $("oTime").textContent = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  $("oDate").textContent = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  for (const node of document.querySelectorAll("[data-until]")) node.textContent = short(Number(node.dataset.until));

  // Something started or ended → rebuild
  const { active, upcoming } = splitBadges(badges);
  if (String(active.length) !== $("oActive").textContent || String(upcoming.length) !== $("oUpcoming").textContent) renderAll();
}

/* ---------- init ---------- */

async function start() {
  const data = await loadBadges();
  badges = data.badges;
  renderAll();
  // New snapshot from the sync → redraw (checks every minute; OBS keeps the page open for days)
  watchBadges(
    (next) => {
      badges = next.badges;
      renderAll();
    },
    { syncedAt: data.syncedAt, intervalMs: 60_000 }
  );
}

start();
setInterval(tick, 1000);
setInterval(() => {
  page += 1;
  renderGrid(splitBadges(badges).active);
}, ROTATE_MS);
