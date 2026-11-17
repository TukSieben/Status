import { fetchChannel, earnableOnStream, paintLiveIndicators } from "./twitch.js";
import { renderSchedule, buildEvents } from "./schedule.js";

const GQL_URL = "https://gql.twitch.tv/gql";
const TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const STORAGE_KEY = "badgestatus_user";
const URGENT_MS = 48 * 60 * 60 * 1000;

const state = {
  badges: [],
  syncedAt: null,
  filter: "all",
  user: null,
  loading: false,
  ownedSetIDs: new Set(),
  ownedUuids: new Set(),
  channel: null,
  toastTimer: null,
};

const $ = (id) => document.getElementById(id);
const els = {
  userForm: $("userForm"),
  userInput: $("userInput"),
  clearUserBtn: $("clearUserBtn"),
  checkBtn: $("checkBtn"),
  checkLabel: $("checkLabel"),
  checkSpin: $("checkSpin"),
  errorBox: $("errorBox"),
  loadingBar: $("loadingBar"),
  loadingUser: $("loadingUser"),
  totalChip: $("totalChip"),
  userBar: $("userBar"),
  userAvatar: $("userAvatar"),
  userName: $("userName"),
  userMissing: $("userMissing"),
  userTotal: $("userTotal"),
  userOwned: $("userOwned"),
  userPct: $("userPct"),
  progressFill: $("progressFill"),
  statsRow: $("statsRow"),
  statAvailable: $("statAvailable"),
  statMissing: $("statMissing"),
  statOwned: $("statOwned"),
  statUpcoming: $("statUpcoming"),
  filterChips: $("filterChips"),
  activeCount: $("activeCount"),
  activeGrid: $("activeGrid"),
  activeEmpty: $("activeEmpty"),
  upcomingCount: $("upcomingCount"),
  upcomingList: $("upcomingList"),
  upcomingEmpty: $("upcomingEmpty"),
  footerSync: $("footerSync"),
  toast: $("toast"),
};

/* ---------- helpers ---------- */

function extractUuid(url) {
  const m = (url || "").match(/\/v1\/([a-f0-9-]{36})\//i);
  return m ? m[1].toLowerCase() : "";
}

function badgeHref(badge) {
  return `badge.html?id=${encodeURIComponent(badge.setID)}`;
}

function img(badge) {
  return badge.image4x || badge.image2x || badge.image1x || "";
}

function onImgError(e) {
  const node = e.currentTarget;
  const src = node.src;
  if (src.endsWith("/3")) node.src = src.slice(0, -2) + "/2";
  else if (src.endsWith("/2")) node.src = src.slice(0, -2) + "/1";
}

function statusOf(badge, now = Date.now()) {
  const end = Date.parse(badge.endAt || "");
  if (Number.isNaN(end) || end <= now) return "ended";
  const start = Date.parse(badge.startAt || "");
  if (!Number.isNaN(start) && start > now) return "upcoming";
  return "active";
}

function isOwned(badge) {
  if (!state.user) return false;
  if (state.ownedSetIDs.has(badge.setID)) return true;
  const uuid = extractUuid(img(badge));
  return Boolean(uuid && state.ownedUuids.has(uuid));
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
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function shortDate(iso) {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function compactNumber(n) {
  if (typeof n !== "number") return "";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function objectiveText(badge) {
  return badge.objective?.trim() || badge.description?.trim() || "Unlock details not announced yet.";
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function pill(text, kind, upper = false) {
  return el("span", `pill pill-${kind}${upper ? " pill-upper" : ""}`, text);
}

function costPill(badge) {
  return badge.cost === "paid" ? pill("Paid", "paid") : pill("Free", "free");
}

function timerSpan(targetMs, extraClass = "") {
  const span = el("span", `timer ${extraClass}`.trim(), countdown(targetMs));
  span.dataset.target = String(targetMs);
  return span;
}

function badgeImg(badge, className) {
  const image = el("img", className);
  image.src = img(badge);
  image.alt = badge.title;
  image.loading = "lazy";
  image.addEventListener("error", onImgError);
  return image;
}

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove("hidden");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 1800);
}

async function gql(query, variables = {}) {
  const res = await fetch(GQL_URL, {
    method: "POST",
    headers: { "Client-ID": TWITCH_CLIENT_ID, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Twitch returned HTTP ${res.status}`);
  const payload = await res.json();
  if (payload.errors?.length) throw new Error(payload.errors[0].message || "Twitch error");
  return payload.data;
}

/* ---------- data ---------- */

function getLists() {
  const now = Date.now();
  const active = [];
  const upcoming = [];
  const seen = new Set();

  for (const b of state.badges) {
    if (seen.has(b.setID)) continue;
    const s = statusOf(b, now);
    if (s === "ended") continue;
    seen.add(b.setID);
    (s === "active" ? active : upcoming).push(b);
  }

  upcoming.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  return { active, upcoming };
}

/* ---------- rendering ---------- */

function renderCard(badge) {
  const owned = isOwned(badge);
  const checked = Boolean(state.user);
  const endMs = Date.parse(badge.endAt);
  const urgent = endMs - Date.now() < URGENT_MS;

  const card = el("a", "card");
  card.href = badgeHref(badge);
  if (checked) card.classList.add(owned ? "is-owned" : "is-missing");

  const status = el("div", "card-status pills");
  if (checked) status.appendChild(owned ? pill("Owned", "owned", true) : pill("Missing", "missing", true));
  else if (urgent) status.appendChild(pill("Ending soon", "urgent", true));

  const title = el("div", "card-title", badge.title);
  title.title = badge.title;

  const objective = el("p", "card-objective", objectiveText(badge));

  const foot = el("div", "card-foot");
  const tags = el("div", "pills");
  tags.appendChild(costPill(badge));
  if (earnableOnStream(badge, state.channel)) tags.appendChild(pill("On our stream", "live"));
  if (checked && urgent && !owned) tags.appendChild(pill("Ending soon", "urgent"));

  const meta = el("div", "card-meta");
  meta.append(el("span", "", "Ends in"), el("span", "users", badge.userCount != null ? `${compactNumber(badge.userCount)} users` : ""));

  foot.append(tags, meta, timerSpan(endMs, urgent ? "is-urgent" : ""));
  card.append(status, badgeImg(badge, "card-img"), title, objective, foot);
  return card;
}

function renderRow(badge) {
  const startMs = Date.parse(badge.startAt);
  const owned = isOwned(badge);

  const row = el("a", "row");
  row.href = badgeHref(badge);

  const main = el("div", "row-main");
  const text = el("div", "row-text");
  text.append(el("div", "row-title", badge.title), el("div", "row-objective", objectiveText(badge)));
  main.append(badgeImg(badge, "row-img"), text);

  const side = el("div", "row-side");
  const pills = el("div", "pills");
  if (state.user && owned) pills.appendChild(pill("Owned", "owned"));
  pills.appendChild(costPill(badge));

  const timer = el("div", "row-timer");
  timer.append(el("span", "row-timer-label", "Starts in"), timerSpan(startMs), el("span", "row-date", shortDate(badge.startAt)));

  side.append(pills, timer);
  row.append(main, side);
  return row;
}

function render() {
  const { active, upcoming } = getLists();
  const ownedActive = active.filter(isOwned);
  const missingActive = active.filter((b) => !isOwned(b));

  els.totalChip.textContent = String(active.length + upcoming.length);
  els.statAvailable.textContent = String(active.length);
  els.statUpcoming.textContent = String(upcoming.length);
  els.statMissing.textContent = state.user ? String(missingActive.length) : "—";
  els.statOwned.textContent = state.user ? String(ownedActive.length) : "—";

  for (const node of els.statsRow.querySelectorAll("[data-filter]")) {
    if (node.dataset.filter !== "all") node.disabled = !state.user;
    node.classList.toggle("is-active", node.dataset.filter === state.filter);
  }
  for (const chip of els.filterChips.querySelectorAll(".chip")) {
    const needsUser = chip.dataset.filter === "missing" || chip.dataset.filter === "owned";
    chip.disabled = needsUser && !state.user;
    chip.classList.toggle("is-active", chip.dataset.filter === state.filter);
  }

  if (state.user) {
    const pct = active.length ? Math.round((ownedActive.length / active.length) * 100) : 0;
    els.userBar.classList.remove("hidden");
    els.userAvatar.src = state.user.profileImageURL || "logo.png?v=2";
    els.userName.textContent = `@${state.user.displayName || state.user.login}`;
    els.userMissing.textContent = String(missingActive.length);
    els.userTotal.textContent = String(active.length);
    els.userOwned.textContent = `${ownedActive.length} Owned`;
    els.userPct.textContent = `${pct}%`;
    els.progressFill.style.width = `${pct}%`;
  } else {
    els.userBar.classList.add("hidden");
  }

  let list = active;
  if (state.filter === "missing") list = missingActive;
  else if (state.filter === "owned") list = ownedActive;
  else if (state.filter === "free") list = active.filter((b) => b.cost !== "paid");
  else if (state.filter === "paid") list = active.filter((b) => b.cost === "paid");

  list = list.slice().sort((a, b) => {
    if (state.user) {
      const oa = isOwned(a);
      const ob = isOwned(b);
      if (oa !== ob) return oa ? 1 : -1;
    }
    if ((a.cost === "paid") !== (b.cost === "paid")) return a.cost === "paid" ? 1 : -1;
    return Date.parse(a.endAt) - Date.parse(b.endAt);
  });

  els.activeCount.textContent = `(${list.length})`;
  els.activeGrid.replaceChildren(...list.map(renderCard));
  els.activeEmpty.classList.toggle("hidden", list.length > 0);
  els.activeEmpty.textContent =
    active.length === 0 ? "There are currently no active Twitch badge drops." : "No badges match this filter.";

  els.upcomingCount.textContent = `(${upcoming.length})`;
  els.upcomingList.replaceChildren(...upcoming.map(renderRow));
  els.upcomingEmpty.classList.toggle("hidden", upcoming.length > 0);
}

function tickTimers() {
  for (const node of document.querySelectorAll("[data-target]")) {
    node.textContent = countdown(Number(node.dataset.target));
  }
  const { active, upcoming } = getLists();
  if (
    active.length !== Number(els.statAvailable.textContent) ||
    upcoming.length !== Number(els.statUpcoming.textContent)
  ) {
    render();
  }
}

/* ---------- user check ---------- */

function setLoading(on, login = "") {
  state.loading = on;
  els.checkBtn.disabled = on;
  els.checkLabel.classList.toggle("hidden", on);
  els.checkSpin.classList.toggle("hidden", !on);
  els.loadingBar.classList.toggle("hidden", !on);
  els.loadingUser.textContent = login ? `@${login}` : "";
}

async function checkUser(raw, { updateUrl = true } = {}) {
  const login = raw.trim().toLowerCase().replace(/^@/, "").replace(/^.*twitch\.tv\//, "").replace(/[/?#].*$/, "");
  if (!login) return;

  els.userInput.value = login;
  els.errorBox.classList.add("hidden");
  setLoading(true, login);

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

    try {
      localStorage.setItem(STORAGE_KEY, data.user.login);
    } catch {}

    if (updateUrl) {
      const url = new URL(location.href);
      url.searchParams.set("user", data.user.login);
      history.replaceState(null, "", url);
    }

    els.clearUserBtn.classList.remove("hidden");
    render();
  } catch (err) {
    els.errorBox.textContent = err?.message || "Could not check this user.";
    els.errorBox.classList.remove("hidden");
  } finally {
    setLoading(false);
  }
}

function clearUser() {
  state.user = null;
  state.ownedSetIDs = new Set();
  state.ownedUuids = new Set();
  if (state.filter === "missing" || state.filter === "owned") state.filter = "all";
  els.userInput.value = "";
  els.clearUserBtn.classList.add("hidden");
  els.errorBox.classList.add("hidden");
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  const url = new URL(location.href);
  url.searchParams.delete("user");
  history.replaceState(null, "", url);
  render();
}

/* ---------- init ---------- */

async function init() {
  try {
    const res = await fetch("./data/badges.json", { cache: "no-cache" });
    if (res.ok) {
      const doc = await res.json();
      state.badges = doc.badges || [];
      state.syncedAt = doc.syncedAt || null;
    }
  } catch {}

  els.footerSync.textContent = state.syncedAt ? `Schedule synced ${formatDate(state.syncedAt)}` : "Schedule unavailable";

  render();
  renderSchedule(document.getElementById("scheduleRoot"), state.badges, {
    href: (ev) => badgeHref(ev.badges[0]),
  });
  document.getElementById("schedCount").textContent = `(${buildEvents(state.badges).length})`;

  const urlUser = new URLSearchParams(location.search).get("user");
  let saved = "";
  try {
    saved = localStorage.getItem(STORAGE_KEY) || "";
  } catch {}
  if (urlUser || saved) await checkUser(urlUser || saved, { updateUrl: Boolean(urlUser) });

  setInterval(tickTimers, 1000);

  const refreshChannel = async () => {
    const next = await fetchChannel();
    if (next) state.channel = next;
    paintLiveIndicators(state.channel);
    const c = state.channel;
    const stripText = document.getElementById("streamStripText");
    if (c?.live) {
      const { active } = getLists();
      const n = active.filter((b) => earnableOnStream(b, c)).length;
      stripText.innerHTML = "";
      stripText.append(
        "Live now on ",
        Object.assign(document.createElement("b"), { textContent: "twitch.tv/badgestatus" }),
        c.game ? ` in ${c.game}` : "",
        n ? ` — ${n} badge${n === 1 ? "" : "s"} earnable on stream right now` : ""
      );
    }
    render();
  };
  refreshChannel();
  setInterval(refreshChannel, 60_000);
}

els.userForm.addEventListener("submit", (e) => {
  e.preventDefault();
  checkUser(els.userInput.value);
});
els.userInput.addEventListener("input", () => {
  els.clearUserBtn.classList.toggle("hidden", !els.userInput.value && !state.user);
});
els.clearUserBtn.addEventListener("click", clearUser);

function setFilter(f) {
  state.filter = f;
  render();
}
for (const chip of els.filterChips.querySelectorAll(".chip")) {
  chip.addEventListener("click", () => setFilter(chip.dataset.filter));
}
for (const stat of els.statsRow.querySelectorAll("button[data-filter]")) {
  stat.addEventListener("click", () => {
    setFilter(stat.dataset.filter);
    document.getElementById("available").scrollIntoView({ behavior: "smooth" });
  });
}

// Highlight nav link for the section in view
const sectionLinks = [...document.querySelectorAll('.nav-link[href^="#"]')];
function updateNavHighlight() {
  let current = "available";
  for (const id of ["available", "schedule", "upcoming"]) {
    const node = document.getElementById(id);
    if (node && node.getBoundingClientRect().top < window.innerHeight * 0.4) current = id;
  }
  if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) current = "upcoming";
  if (window.scrollY < 40) current = "available";
  for (const link of sectionLinks) link.classList.toggle("is-active", link.getAttribute("href") === `#${current}`);
}
window.addEventListener("scroll", updateNavHighlight, { passive: true });
updateNavHighlight();

init();
