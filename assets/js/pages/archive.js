import "../lib/background.js?v=23";
import { $, el, badgeImg, badgeHref, formatDate, loadBadges, watchBadges } from "../lib/utils.js";
import { fetchChannel, paintLiveIndicators } from "../lib/twitch.js";
import { plannedMonth, plannedLabel } from "../lib/planned.js?v=1";

const PAGE_SIZE = 96;

const state = {
  sets: [], // one entry per badge set (newest version), enriched
  query: "",
  status: "all",
  category: "",
  cost: "",
  sort: "newest",
  shown: PAGE_SIZE,
};

/* ---------- data ---------- */

function statusOf(b, now = Date.now()) {
  if (b.alwaysAvailable) return "permanent";
  const end = Date.parse(b.endAt || "");
  const start = Date.parse(b.startAt || "");
  if (!Number.isNaN(start) && start > now) return "upcoming";
  // no dates yet, but announced for a coming month
  if (Number.isNaN(start) && Number.isNaN(end) && plannedMonth(b) > now) return "upcoming";
  if (!Number.isNaN(end) && end > now) return "active";
  return "ended";
}

/**
 * Best guess of when a badge came out: its start date, its year, or when the sync first saw it.
 * Badges from the initial import have no real "first seen" date, so they count as unknown (0).
 */
function releasedAt(b) {
  const start = Date.parse(b.startAt || "");
  if (!Number.isNaN(start)) return start;
  const planned = plannedMonth(b);
  if (!Number.isNaN(planned)) return planned;
  if (b.year) return Date.UTC(b.year, 0, 1);
  if (b.isInitialSeed) return 0;
  const seen = Date.parse(b.firstSeen || "");
  return Number.isNaN(seen) ? 0 : seen;
}

function releaseLabel(b) {
  if (b.startAt) return new Date(b.startAt).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  const planned = plannedMonth(b);
  if (!Number.isNaN(planned)) return plannedLabel(planned);
  if (b.year) return String(b.year);
  return "";
}

/** One card per set: the newest version, with the number of versions. */
function toSets(badges) {
  const bySet = new Map();
  for (const b of badges) {
    const list = bySet.get(b.setID) || [];
    list.push(b);
    bySet.set(b.setID, list);
  }
  const now = Date.now();
  return [...bySet.values()].map((versions) => {
    versions.sort((a, b) => Number(b.version) - Number(a.version));
    const b = versions[0];
    return {
      badge: b,
      versions: versions.length,
      status: statusOf(b, now),
      released: releasedAt(b),
      search: `${b.title} ${b.setID} ${b.eventName || ""} ${b.game || ""}`.toLowerCase(),
    };
  });
}

/* ---------- rendering ---------- */

const STATUS_TAG = {
  active: ["Available", "is-free"],
  upcoming: ["Upcoming", "is-live"],
  permanent: ["Permanent", ""],
  ended: ["", ""],
};

function renderCard(item) {
  const b = item.badge;
  const card = el("a", "card");
  card.href = badgeHref(b);
  card.title = b.description || b.title;
  if (item.status === "ended") card.classList.add("is-ended");

  const meta = el("div", "card-meta");
  const [label, cls] = STATUS_TAG[item.status];
  if (label) meta.appendChild(el("span", `tag ${cls}`, label));
  const when = releaseLabel(b);
  if (when) meta.appendChild(el("span", "tag", when));
  if (item.versions > 1) meta.appendChild(el("span", "tag", `${item.versions} tiers`));

  card.append(badgeImg(b, "card-img"), el("div", "card-title", b.title), meta);
  return card;
}

function filtered() {
  const q = state.query.trim().toLowerCase();
  let list = state.sets.filter((s) => {
    if (state.status !== "all" && s.status !== state.status) return false;
    if (state.category && s.badge.category !== state.category) return false;
    if (state.cost && s.badge.cost !== state.cost) return false;
    if (q && !s.search.includes(q)) return false;
    return true;
  });
  const owners = (s) => (typeof s.badge.userCount === "number" ? s.badge.userCount : null);
  const by = {
    newest: (a, b) => b.released - a.released,
    oldest: (a, b) => (a.released || Infinity) - (b.released || Infinity),
    name: (a, b) => a.badge.title.localeCompare(b.badge.title),
    popular: (a, b) => (owners(b) ?? -1) - (owners(a) ?? -1),
    rare: (a, b) => (owners(a) ?? Infinity) - (owners(b) ?? Infinity),
  };
  list = list.slice().sort(by[state.sort]);
  return list;
}

function render() {
  const list = filtered();
  const page = list.slice(0, state.shown);
  $("aGrid").replaceChildren(...page.map(renderCard));
  $("aEmpty").classList.toggle("hidden", list.length > 0);
  $("aMore").classList.toggle("hidden", list.length <= state.shown);
  $("aMore").textContent = `Show more (${list.length - page.length})`;
  $("aResult").textContent = list.length === state.sets.length ? "" : `${list.length} of ${state.sets.length} badges`;

  for (const chip of $("aStatus").querySelectorAll(".chip")) {
    chip.classList.toggle("is-active", chip.dataset.value === state.status);
  }

  // Keep filters in the URL so a filtered view can be shared
  const url = new URL(location.href);
  for (const [k, v, def] of [
    ["q", state.query.trim(), ""],
    ["status", state.status, "all"],
    ["category", state.category, ""],
    ["cost", state.cost, ""],
    ["sort", state.sort, "newest"],
  ]) {
    if (v && v !== def) url.searchParams.set(k, v);
    else url.searchParams.delete(k);
  }
  history.replaceState(null, "", url);
}

function update(patch) {
  Object.assign(state, patch, { shown: PAGE_SIZE });
  render();
}

/* ---------- events ---------- */

let searchTimer = 0;
$("aQuery").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => update({ query: e.target.value }), 120);
});
for (const chip of $("aStatus").querySelectorAll(".chip")) {
  chip.addEventListener("click", () => update({ status: chip.dataset.value }));
}
$("aCategory").addEventListener("change", (e) => update({ category: e.target.value }));
$("aCost").addEventListener("change", (e) => update({ cost: e.target.value }));
$("aSort").addEventListener("change", (e) => update({ sort: e.target.value }));
$("aMore").addEventListener("click", () => {
  state.shown += PAGE_SIZE;
  render();
});

/* ---------- init ---------- */

function renderCounts() {
  $("aTotal").textContent = String(state.sets.length);
  $("aActive").textContent = String(state.sets.filter((s) => s.status === "active").length);
  $("aEnded").textContent = String(state.sets.filter((s) => s.status === "ended").length);

  const select = $("aCategory");
  const have = new Set([...select.options].map((o) => o.value));
  const categories = [...new Set(state.sets.map((s) => s.badge.category).filter(Boolean))].sort();
  select.append(...categories.filter((c) => !have.has(c)).map((c) => Object.assign(el("option", "", c), { value: c })));
}

async function init() {
  const data = await loadBadges();
  state.sets = toSets(data.badges);
  $("footerSync").textContent = data.syncedAt ? `Updated ${formatDate(data.syncedAt)}` : "";

  renderCounts();

  // Restore filters from the URL
  const p = new URLSearchParams(location.search);
  state.query = p.get("q") || "";
  state.status = p.get("status") || "all";
  state.category = p.get("category") || "";
  state.cost = p.get("cost") || "";
  state.sort = p.get("sort") || "newest";
  $("aQuery").value = state.query;
  $("aCategory").value = state.category;
  $("aCost").value = state.cost;
  $("aSort").value = state.sort;

  render();

  // New snapshot from the sync → rebuild the list in place (keeps search, filters and paging)
  watchBadges(
    (next) => {
      const shown = state.shown;
      state.sets = toSets(next.badges);
      $("footerSync").textContent = `Updated ${formatDate(next.syncedAt)}`;
      renderCounts();
      state.shown = shown;
      render();
    },
    { syncedAt: data.syncedAt }
  );

  const live = await fetchChannel();
  paintLiveIndicators(live);
}

init();
