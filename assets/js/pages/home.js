import "../lib/background.js?v=30";
import {
  $,
  el,
  badgeImg,
  badgeHref,
  objectiveText,
  timerSpan,
  refreshTimers,
  splitBadges,
  formatDate,
  shortDate,
  loadBadges,
  watchBadges,
  normalizeLogin,
  URGENT_MS,
} from "../lib/utils.js";
import { fetchChannel, earnableOnStream, paintLiveIndicators, playerSrc } from "../lib/twitch.js";
import { renderSchedule } from "../lib/schedule.js?v=34";
import { plannedMonth, plannedLabel } from "../lib/planned.js?v=1";

let badges = [];
let channel = null;

function miniRow(b, mode) {
  const target = Date.parse(mode === "ending" ? b.endAt : b.startAt);
  const urgent = mode === "ending" && target - Date.now() < URGENT_MS;

  const row = el("a", "mini-row");
  row.href = badgeHref(b);
  row.title = objectiveText(b);

  const title = el("span", "mini-title", b.title);
  title.appendChild(el("span", "mini-sub", shortDate(mode === "ending" ? b.endAt : b.startAt)));
  const side = el("span", "mini-side");
  if (mode === "ending" && earnableOnStream(b, channel)) side.appendChild(el("span", "tag is-live", "On stream"));
  side.append(
    el("span", `tag ${b.cost === "paid" ? "is-paid" : "is-free"}`, b.cost === "paid" ? "Paid" : "Free"),
    timerSpan(target, urgent ? "is-urgent" : "")
  );

  row.append(badgeImg(b, "mini-img", 2), title, side);
  return row;
}

/** Announced for a coming month but no dates yet ("… during December 2026") — one per set */
function announcedBadges(now = Date.now()) {
  const seen = new Set();
  return badges
    .filter((b) => {
      if (seen.has(b.setID) || b.startAt || b.endAt) return false;
      const ok = plannedMonth(b) > now;
      if (ok) seen.add(b.setID);
      return ok;
    })
    .sort((a, b) => plannedMonth(a) - plannedMonth(b) || a.title.localeCompare(b.title));
}

function announcedRow(b) {
  const row = el("a", "mini-row");
  row.href = badgeHref(b);
  row.title = objectiveText(b);
  const title = el("span", "mini-title", b.title);
  title.appendChild(el("span", "mini-sub", "Announced"));
  const side = el("span", "mini-side");
  side.append(
    el("span", `tag ${b.cost === "paid" ? "is-paid" : "is-free"}`, b.cost === "paid" ? "Paid" : "Free"),
    el("span", "timer", plannedLabel(plannedMonth(b)))
  );
  row.append(badgeImg(b, "mini-img", 2), title, side);
  return row;
}

function emptyNote(text) {
  return el("div", "mini-empty", text);
}

function render() {
  const { active, upcoming } = splitBadges(badges);

  $("heroActive").textContent = String(active.length);
  const announced = announcedBadges();
  $("heroUpcoming").textContent = String(upcoming.length + announced.length);
  const next = upcoming[0];
  $("heroNextWrap").classList.toggle("hidden", !next);
  if (next) $("heroNext").replaceChildren(timerSpan(Date.parse(next.startAt)));

  const ending = active
    .slice()
    .sort((a, b) => Date.parse(a.endAt) - Date.parse(b.endAt))
    .slice(0, 6);
  $("endingList").replaceChildren(
    ...(ending.length
      ? ending.map((b) => miniRow(b, "ending"))
      : [emptyNote("No active badge drops right now.")])
  );

  const starting = upcoming
    .slice()
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    .slice(0, 6);
  const rows = [...starting.map((b) => miniRow(b, "starting")), ...announced.slice(0, Math.max(0, 6 - starting.length)).map(announcedRow)];
  $("startingList").replaceChildren(...(rows.length ? rows : [emptyNote("No upcoming badges announced yet.")]));
}

function drawSchedule() {
  renderSchedule($("scheduleRoot"), badges, {
    href: (ev) => badgeHref(ev.badges[0]),
  });
}

/** Player while live (embedded once, never reloaded), offline card otherwise. */
function renderStream() {
  const live = Boolean(channel?.live);
  const frame = $("heroStreamFrame");
  $("heroStream").classList.toggle("is-live", live);
  if (channel?.offlineImage) $("heroStreamOffline").style.backgroundImage = `url("${channel.offlineImage}")`;
  if (channel?.avatar) $("heroStreamAvatar").src = channel.avatar;
  if (live && !frame.querySelector("iframe")) {
    const iframe = document.createElement("iframe");
    iframe.src = playerSrc();
    iframe.title = "BadgeStatus 24/7 stream";
    iframe.allowFullscreen = true;
    iframe.setAttribute("allow", "autoplay; fullscreen");
    frame.replaceChildren(iframe);
  } else if (!live && frame.firstChild) {
    frame.replaceChildren();
  }
}

async function refreshChannel() {
  const next = await fetchChannel();
  if (next) channel = next;
  paintLiveIndicators(channel);
  renderStream();
  render();
}

function tick() {
  refreshTimers();
  const { active, upcoming } = splitBadges(badges);
  if (
    active.length !== Number($("heroActive").textContent) ||
    upcoming.length + announcedBadges().length !== Number($("heroUpcoming").textContent)
  ) {
    render();
  }
}

$("homeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const login = normalizeLogin($("homeInput").value);
  location.href = login
    ? `/badges/?user=${encodeURIComponent(login)}`
    : "/badges/";
});

async function init() {
  const data = await loadBadges();
  badges = data.badges;
  $("footerSync").textContent = data.syncedAt
    ? `Updated ${formatDate(data.syncedAt)}`
    : "";
  render();
  drawSchedule();
  setInterval(tick, 1000);
  refreshChannel();
  setInterval(refreshChannel, 60_000);

  watchBadges(
    (next) => {
      badges = next.badges;
      $("footerSync").textContent = `Updated ${formatDate(next.syncedAt)}`;
      render();
      drawSchedule();
    },
    { syncedAt: data.syncedAt }
  );
}

init();
