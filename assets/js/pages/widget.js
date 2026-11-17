// Corner widget for live gameplay streams. Keeps itself up to date like the big overlay.
import { $, el, badgeImg, splitBadges, loadBadges, watchBadges, URGENT_MS } from "../lib/utils.js";
import { buildEvents } from "../lib/schedule.js";

const game = (new URLSearchParams(location.search).get("game") || "").trim();
let badges = [];

function short(ms) {
  const diff = Math.max(0, ms - Date.now());
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff / 3_600_000) % 24);
  const m = Math.floor((diff / 60_000) % 60);
  const s = Math.floor((diff / 1000) % 60);
  const pad = (n) => String(n).padStart(2, "0");
  return d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function timer(ms, urgent) {
  const s = el("span", `wg-timer${urgent ? " is-urgent" : ""}`, short(ms));
  s.dataset.until = String(ms);
  return s;
}

function row(b, ms, canBeUrgent = true) {
  const r = el("div", "wg-row");
  const paid = b.cost === "paid";
  r.append(
    badgeImg(b, "", 2),
    el("span", "wg-row-title", b.title),
    el("span", `wg-tag ${paid ? "is-paid" : "is-free"}`, paid ? "Paid" : "Free"),
    timer(ms, canBeUrgent && ms - Date.now() < URGENT_MS)
  );
  return r;
}

/** Badges for the game being played (matched on category / objective / event name). */
function gameBadges(active) {
  const g = game.toLowerCase();
  return active.filter((b) => `${b.game || ""} ${b.objective || ""} ${b.eventName || ""}`.toLowerCase().includes(g));
}

function render() {
  const { active, upcoming } = splitBadges(badges);

  if (game) {
    const here = gameBadges(active).sort((a, b) => Date.parse(a.endAt) - Date.parse(b.endAt));
    const soon = gameBadges(upcoming);
    $("wgLabel").textContent = "Earn badges in this stream";
    $("wgTitle").textContent = game;
    $("wgIcons").replaceChildren(...[...here, ...soon].slice(0, 10).map((b) => badgeImg(b, "", 4)));
    const first = here[0] || soon[0];
    $("wgCount").replaceChildren(
      ...(first ? [el("span", "wg-count-label", here.length ? "Ends in" : "Starts in"), timer(Date.parse(here.length ? first.endAt : first.startAt))] : [])
    );
    $("wgListLabel").textContent = here.length ? `${here.length} available now` : "Coming soon";
    const list = here.length ? here : soon;
    $("wgList").replaceChildren(
      ...(list.length
        ? list.slice(0, 4).map((b) => row(b, Date.parse(here.length ? b.endAt : b.startAt), here.length > 0))
        : [el("div", "wg-empty", "No badges for this game right now.")])
    );
    return;
  }

  // Default: next drop + ending soon
  const upcomingEvents = buildEvents(badges).filter((e) => e.upcoming);
  const base = (n) => n.replace(/\s*\((subscribe|sub|watch)\)$/i, "");
  const next = upcomingEvents[0];
  const together = next ? upcomingEvents.filter((e) => e.start === next.start && base(e.name) === base(next.name)) : [];
  $("wgLabel").textContent = "Next drop";
  $("wgTitle").textContent = next ? base(next.name) : "Nothing announced yet";
  $("wgIcons").replaceChildren(...together.flatMap((e) => e.badges).slice(0, 10).map((b) => badgeImg(b, "", 4)));
  $("wgCount").replaceChildren(...(next ? [el("span", "wg-count-label", "Starts in"), timer(next.start)] : []));
  $("wgListLabel").textContent = "Ending soon";
  const ending = active.slice().sort((a, b) => Date.parse(a.endAt) - Date.parse(b.endAt)).slice(0, 4);
  $("wgList").replaceChildren(...ending.map((b) => row(b, Date.parse(b.endAt))));
}

function tick() {
  for (const n of document.querySelectorAll("[data-until]")) n.textContent = short(Number(n.dataset.until));
}

const data = await loadBadges();
badges = data.badges;
render();
setInterval(tick, 1000);
setInterval(render, 60_000); // move badges between "upcoming" / "available" as times pass
watchBadges((next) => {
  badges = next.badges;
  render();
}, { syncedAt: data.syncedAt, intervalMs: 60_000 });
