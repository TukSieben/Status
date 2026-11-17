import "../lib/background.js";
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
import { renderSchedule } from "../lib/schedule.js";

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

function emptyNote(text) {
  return el("div", "mini-empty", text);
}

function render() {
  const { active, upcoming } = splitBadges(badges);

  $("heroActive").textContent = String(active.length);
  $("heroUpcoming").textContent = String(upcoming.length);
  const next = upcoming[0];
  $("heroNextWrap").classList.toggle("hidden", !next);
  if (next) $("heroNext").replaceChildren(timerSpan(Date.parse(next.startAt)));

  // Hero showcase: current badges floating freely (no tiles), scattered on a loose grid
  const showcase = $("heroShowcase");
  const wall = [...active, ...upcoming].slice(0, 11);
  // Rebuild only when the set of badges changes, so the float animation never restarts
  const wallKey = wall.map((b) => b.setID).join(",");
  if (showcase.dataset.key !== wallKey) {
    showcase.dataset.key = wallKey;
    const spots = [
      [6, 8, 64],
      [34, 2, 54],
      [62, 10, 70],
      [86, 4, 48],
      [16, 40, 52],
      [44, 34, 78],
      [74, 42, 56],
      [4, 72, 58],
      [30, 70, 46],
      [56, 74, 62],
      [84, 70, 50],
    ];
    showcase.replaceChildren(
      ...wall.map((b, i) => {
        const [x, y, size] = spots[i];
        const tile = el("a", "show-tile");
        tile.href = badgeHref(b);
        tile.title = b.title;
        tile.style.left = `${x}%`;
        tile.style.top = `${y}%`;
        tile.style.width = `${size}px`;
        tile.style.height = `${size}px`;
        tile.style.animationDelay = `${-(i * 0.9) % 6}s`;
        tile.style.animationDuration = `${5 + (i % 4)}s`;
        tile.style.setProperty(
          "--rot",
          `${(i % 2 ? -1 : 1) * (3 + (i % 3) * 2)}deg`,
        );
        tile.style.setProperty("--dx", `${((i % 3) - 1) * 6}px`);
        tile.style.setProperty("--dy", `${-8 - (i % 4) * 3}px`);
        tile.appendChild(badgeImg(b, ""));
        return tile;
      }),
    );
  }
  showcase.classList.toggle("hidden", wall.length === 0);

  const ending = active
    .slice()
    .sort((a, b) => Date.parse(a.endAt) - Date.parse(b.endAt))
    .slice(0, 6);
  $("endingList").replaceChildren(
    ...(ending.length
      ? ending.map((b) => miniRow(b, "ending"))
      : [emptyNote("No active badge drops right now.")]),
  );

  const starting = upcoming
    .slice()
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    .slice(0, 6);
  $("startingList").replaceChildren(
    ...(starting.length
      ? starting.map((b) => miniRow(b, "starting"))
      : [emptyNote("No upcoming badges announced yet.")]),
  );

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
  // Offline: use the channel's own offline image and avatar from Twitch when available
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
    upcoming.length !== Number($("heroUpcoming").textContent)
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

  // New snapshot from the sync (new badges, times, counts) → redraw everything in place
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
