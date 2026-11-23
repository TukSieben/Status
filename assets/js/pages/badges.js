import "../lib/background.js?v=30";
import {
  $,
  el,
  badgeImg,
  badgeHref,
  extractUuid,
  img,
  splitBadges,
  objectiveText,
  timerSpan,
  refreshTimers,
  formatDate,
  shortDate,
  loadBadges,
  watchBadges,
  gql,
  normalizeLogin,
  URGENT_MS,
} from "../lib/utils.js";
import { fetchChannel, earnableOnStream, paintLiveIndicators } from "../lib/twitch.js";

const state = {
  badges: [],
  filter: "all",
  user: null,
  ownedSetIDs: new Set(),
  ownedUuids: new Set(),
  channel: null,
};

/* ---------- helpers ---------- */

function isOwned(badge) {
  if (!state.user) return false;
  if (state.ownedSetIDs.has(badge.setID)) return true;
  const uuid = extractUuid(img(badge));
  return Boolean(uuid && state.ownedUuids.has(uuid));
}

function costTag(badge) {
  const paid = badge.cost === "paid";
  return el("span", `tag ${paid ? "is-paid" : "is-free"}`, paid ? "Paid" : "Free");
}

/* ---------- rendering ---------- */

function renderCard(badge) {
  const owned = isOwned(badge);
  const endMs = Date.parse(badge.endAt);
  const urgent = endMs - Date.now() < URGENT_MS;

  const card = el("a", "card");
  card.href = badgeHref(badge);
  card.title = objectiveText(badge);
  if (state.user) {
    card.classList.add(owned ? "is-owned" : "is-missing");
    card.appendChild(el("span", "card-flag", owned ? "Owned" : "Missing"));
  }

  const meta = el("div", "card-meta");
  meta.appendChild(costTag(badge));
  if (earnableOnStream(badge, state.channel)) meta.appendChild(el("span", "tag is-live", "Stream"));
  meta.appendChild(timerSpan(endMs, urgent ? "is-urgent" : ""));

  card.append(badgeImg(badge, "card-img"), el("div", "card-title", badge.title), meta);
  return card;
}

function renderRow(badge) {
  const row = el("a", "mini-row");
  row.href = badgeHref(badge);
  row.title = objectiveText(badge);

  const title = el("span", "mini-title", badge.title);
  title.appendChild(el("span", "mini-sub", shortDate(badge.startAt)));

  const side = el("span", "mini-side");
  if (isOwned(badge)) side.appendChild(el("span", "tag is-owned", "Owned"));
  side.append(costTag(badge), timerSpan(Date.parse(badge.startAt)));

  row.append(badgeImg(badge, "mini-img", 2), title, side);
  return row;
}

function render() {
  const { active, upcoming } = splitBadges(state.badges);
  const owned = active.filter(isOwned);
  const missing = active.filter((b) => !isOwned(b));
  const checked = Boolean(state.user);

  // Meta line
  $("mAvailable").textContent = String(active.length);
  $("mUpcoming").textContent = String(upcoming.length);
  $("mMissing").textContent = String(missing.length);
  $("mOwned").textContent = String(owned.length);
  $("mMissingWrap").classList.toggle("hidden", !checked);
  $("mOwnedWrap").classList.toggle("hidden", !checked);

  // Filter chips (missing/owned only exist after a check)
  for (const chip of $("filterChips").querySelectorAll(".chip")) {
    const needsUser = chip.dataset.filter === "missing" || chip.dataset.filter === "owned";
    chip.classList.toggle("hidden", needsUser && !checked);
    chip.classList.toggle("is-active", chip.dataset.filter === state.filter);
  }

  // User summary
  $("userBar").classList.toggle("hidden", !checked);
  if (checked) {
    const pct = active.length ? Math.round((owned.length / active.length) * 100) : 0;
    $("userAvatar").src = state.user.profileImageURL || "/assets/img/logo.png";
    $("userName").textContent = state.user.displayName || state.user.login;
    $("userCount").textContent = `${owned.length}/${active.length}`;
    $("progressFill").style.width = `${pct}%`;
  }

  // Grid
  let list = active;
  if (state.filter === "missing") list = missing;
  else if (state.filter === "owned") list = owned;
  else if (state.filter === "free") list = active.filter((b) => b.cost !== "paid");
  else if (state.filter === "paid") list = active.filter((b) => b.cost === "paid");

  list = list.slice().sort((a, b) => {
    if (checked) {
      const oa = isOwned(a);
      const ob = isOwned(b);
      if (oa !== ob) return oa ? 1 : -1;
    }
    if ((a.cost === "paid") !== (b.cost === "paid")) return a.cost === "paid" ? 1 : -1;
    return Date.parse(a.endAt) - Date.parse(b.endAt);
  });

  $("activeGrid").replaceChildren(...list.map(renderCard));
  $("activeEmpty").classList.toggle("hidden", list.length > 0);
  const allDone = checked && state.filter === "missing" && active.length > 0 && missing.length === 0;
  $("activeEmpty").textContent = active.length === 0 ? "No active badge drops right now." : allDone ? "You have every active badge. Nice." : "No badges match this filter.";
  $("activeEmpty").dataset.mood = allDone ? "happy" : "bored";

  // Upcoming
  $("upcomingList").replaceChildren(
    ...(upcoming.length ? upcoming.map(renderRow) : [el("div", "mini-empty", "No upcoming badges announced yet.")])
  );
}

function tick() {
  refreshTimers();
  const { active, upcoming } = splitBadges(state.badges);
  if (active.length !== Number($("mAvailable").textContent) || upcoming.length !== Number($("mUpcoming").textContent)) {
    render();
  }
}

/* ---------- user check ---------- */

function setLoading(on) {
  $("checkBtn").disabled = on;
  $("checkLabel").classList.toggle("hidden", on);
  $("checkSpin").classList.toggle("hidden", !on);
}

async function checkUser(raw) {
  const login = normalizeLogin(raw);
  if (!login) return;

  $("userInput").value = login;
  $("errorBox").classList.add("hidden");
  setLoading(true);

  try {
    const data = await gql(
      `query CheckUser($login: String!) {
        user(login: $login) { id login displayName profileImageURL(width: 70) }
        channelViewer(channelLogin: $login, userLogin: $login) {
          earnedBadges { setID version imageURL(size: QUADRUPLE) }
        }
      }`,
      { login }
    );
    if (!data?.user?.id) throw new Error(`Twitch user "${login}" was not found.`);

    state.user = data.user;
    state.ownedSetIDs = new Set();
    state.ownedUuids = new Set();
    for (const b of data.channelViewer?.earnedBadges || []) {
      if (b.setID) state.ownedSetIDs.add(b.setID);
      const uuid = extractUuid(b.imageURL);
      if (uuid) state.ownedUuids.add(uuid);
    }

    // Shareable link for this session only — the username is never stored
    const url = new URL(location.href);
    url.searchParams.set("user", data.user.login);
    history.replaceState(null, "", url);

    $("clearUserBtn").classList.remove("hidden");
    render();
  } catch (err) {
    $("errorBox").textContent = err?.message || "Could not check this user.";
    $("errorBox").classList.remove("hidden");
  } finally {
    setLoading(false);
  }
}

function clearUser() {
  state.user = null;
  state.ownedSetIDs = new Set();
  state.ownedUuids = new Set();
  if (state.filter === "missing" || state.filter === "owned") state.filter = "all";
  $("userInput").value = "";
  $("clearUserBtn").classList.add("hidden");
  $("errorBox").classList.add("hidden");
  const url = new URL(location.href);
  url.searchParams.delete("user");
  history.replaceState(null, "", url);
  render();
}

/* ---------- events ---------- */

$("userForm").addEventListener("submit", (e) => {
  e.preventDefault();
  checkUser($("userInput").value);
});
$("userInput").addEventListener("input", () => {
  $("clearUserBtn").classList.toggle("hidden", !$("userInput").value && !state.user);
});
$("clearUserBtn").addEventListener("click", clearUser);
for (const chip of $("filterChips").querySelectorAll(".chip")) {
  chip.addEventListener("click", () => {
    state.filter = chip.dataset.filter;
    render();
  });
}

/* ---------- init ---------- */

async function refreshChannel() {
  const next = await fetchChannel();
  if (next) state.channel = next;
  paintLiveIndicators(state.channel);
  render();
}

async function init() {
  const data = await loadBadges();
  state.badges = data.badges;
  $("footerSync").textContent = data.syncedAt ? `Updated ${formatDate(data.syncedAt)}` : "";
  render();

  const urlUser = new URLSearchParams(location.search).get("user");
  if (urlUser) await checkUser(urlUser);

  setInterval(tick, 1000);
  refreshChannel();
  setInterval(refreshChannel, 60_000);

  // New snapshot from the sync → redraw in place (keeps the checked user and filters)
  watchBadges(
    (next) => {
      state.badges = next.badges;
      $("footerSync").textContent = `Updated ${formatDate(next.syncedAt)}`;
      render();
    },
    { syncedAt: data.syncedAt }
  );
}

init();
