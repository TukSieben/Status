import "../lib/background.js";
import {
  $,
  el,
  badgeImg,
  badgeHref,
  objectiveText,
  pill,
  costPill,
  timerSpan,
  refreshTimers,
  splitBadges,
  formatDate,
  compactNumber,
  loadBadges,
  normalizeLogin,
  URGENT_MS,
} from "../lib/utils.js";
import {
  fetchChannel,
  earnableOnStream,
  chatSrc,
  paintLiveIndicators,
} from "../lib/twitch.js";
import { renderSchedule, buildEvents } from "../lib/schedule.js";

let badges = [];
let channel = null;

function miniRow(b, mode) {
  const target = Date.parse(mode === "ending" ? b.endAt : b.startAt);
  const urgent = mode === "ending" && target - Date.now() < URGENT_MS;

  const row = el("a", "mini-row");
  row.href = badgeHref(b);

  const text = el("div", "row-text");
  text.append(
    el("div", "row-title", b.title),
    el("div", "row-objective", objectiveText(b)),
  );

  const side = el("div", "mini-side");
  if (mode === "ending" && earnableOnStream(b, channel))
    side.appendChild(el("span", "pill pill-live", "On stream"));
  side.append(costPill(b), timerSpan(target, urgent ? "is-urgent" : ""));

  row.append(badgeImg(b, "row-img"), text, side);
  return row;
}

function newestCard(b) {
  const endMs = Date.parse(b.endAt);
  const urgent = endMs - Date.now() < URGENT_MS;

  const card = el("a", "card");
  card.href = badgeHref(b);

  const status = el("div", "card-status pills");
  status.appendChild(el("span", "pill pill-soon pill-upper", "New"));

  const title = el("div", "card-title", b.title);
  const objective = el("p", "card-objective", objectiveText(b));

  const foot = el("div", "card-foot");
  const tags = el("div", "pills");
  tags.appendChild(costPill(b));
  if (earnableOnStream(b, channel))
    tags.appendChild(el("span", "pill pill-live", "On stream"));
  const meta = el("div", "card-meta");
  meta.append(
    el("span", "", "Ends in"),
    el(
      "span",
      "users",
      b.userCount != null ? `${compactNumber(b.userCount)} users` : "",
    ),
  );
  foot.append(tags, meta, timerSpan(endMs, urgent ? "is-urgent" : ""));

  card.append(status, badgeImg(b, "card-img"), title, objective, foot);
  return card;
}

function emptyNote(text) {
  return el("div", "mini-empty", text);
}

function render() {
  const { active, upcoming } = splitBadges(badges);

  $("hsActive").textContent = String(active.length);
  $("hsUpcoming").textContent = String(upcoming.length);
  $("hsFree").textContent = String(
    active.filter((b) => b.cost !== "paid").length,
  );
  $("hsTotal").textContent = String(new Set(badges.map((b) => b.setID)).size);
  $("heroLive").textContent = `${active.length} badges available right now`;

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
    .slice(0, 5);
  $("endingList").replaceChildren(
    ...(ending.length
      ? ending.map((b) => miniRow(b, "ending"))
      : [emptyNote("No active badge drops right now.")]),
  );

  const starting = upcoming
    .slice()
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    .slice(0, 5);
  $("startingList").replaceChildren(
    ...(starting.length
      ? starting.map((b) => miniRow(b, "starting"))
      : [emptyNote("No upcoming badges announced yet.")]),
  );

  const newest = active
    .slice()
    .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt))
    .slice(0, 6);
  $("newestCount").textContent = `(${newest.length})`;
  $("newestGrid").replaceChildren(...newest.map(newestCard));
}

function renderStream() {
  paintLiveIndicators(channel);
  const status = $("chatStatus");
  if (channel?.live) {
    status.textContent = `Live${channel.game ? ` in ${channel.game}` : ""} · ${channel.viewers.toLocaleString("en-US")} watching`;
    status.classList.add("is-live");
  } else {
    status.textContent = "Offline · twitch.tv/badgestatus";
    status.classList.remove("is-live");
  }
}

function embedChat() {
  const chat = document.createElement("iframe");
  chat.src = chatSrc();
  chat.title = "BadgeStatus Twitch chat";
  $("chatFrame").replaceChildren(chat);
}

function drawSchedule() {
  renderSchedule($("scheduleRoot"), badges, {
    href: (ev) => badgeHref(ev.badges[0]),
  });
  $("schedCount").textContent = `(${buildEvents(badges).length})`;
}

async function refreshChannel() {
  const next = await fetchChannel();
  if (next) channel = next;
  renderStream();
  render();
}

function tick() {
  refreshTimers();
  const { active, upcoming } = splitBadges(badges);
  if (
    active.length !== Number($("hsActive").textContent) ||
    upcoming.length !== Number($("hsUpcoming").textContent)
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
    ? `Schedule synced ${formatDate(data.syncedAt)}`
    : "";
  embedChat();
  render();
  drawSchedule();
  renderStream();
  setInterval(tick, 1000);
  refreshChannel();
  setInterval(refreshChannel, 60_000);
}

init();
