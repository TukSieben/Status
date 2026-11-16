const GQL_URL = "https://gql.twitch.tv/gql";
const TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const PAGE_SIZE = 48;

const ROLE_SET_IDS = new Set([
  "admin",
  "ambassador",
  "artist-badge",
  "bot-badge",
  "broadcaster",
  "global_mod",
  "lead_moderator",
  "moderator",
  "no_audio",
  "no_video",
  "partner",
  "staff",
  "twitchbot",
  "vip",
]);

const PLATFORM_SET_IDS = new Set([
  "anonymous-cheerer",
  "bits",
  "bits-leader",
  "clips-leader",
  "founder",
  "glitchcon2020",
  "hype-train",
  "mod-founder",
  "predictions",
  "premium",
  "social-sharing",
  "sub-gift-leader",
  "sub-gifter",
  "subscriber",
  "turbo",
]);

const PAID_PLATFORM_IDS = new Set([
  "anonymous-cheerer",
  "bits",
  "bits-leader",
  "founder",
  "hype-train",
  "mod-founder",
  "premium",
  "sub-gift-leader",
  "sub-gifter",
  "subscriber",
  "turbo",
]);

const PAID_RE =
  /\b(sub|subbed|subbing|subscribe|subscribed|subscribing|gift|gifted|gifting|bits|cheer|cheered|cheering|support|supported|supporting|purchas\w*|turbo|tier)\b/i;
const WATCH_RE =
  /\b(watch|watched|watching|view|viewed|viewing|tuned in|drop|drops|livestream|premiere)\b/i;
const ACTION_RE =
  /\b(clip|clipped|clipping|chat|chatted|chatting|vote|voted|voting|quest|campaign|creator|raid|share|shared|sharing)\b/i;
const YEAR_RE = /\b(20\d{2})\b/g;

const state = {
  view: "home",
  badges: [],
  snapshotKeys: new Set(),
  liveAdded: [],
  liveRemovedCount: 0,
  changelog: [],
  syncedAt: null,
  liveConnected: false,
  layout: "list",
  grouped: true,
  sort: "users",
  dir: "desc",
  cost: "any",
  category: "any",
  search: "",
  page: 1,
  showAll: false,
  activeModalBadge: null,
  activeModalSiblings: [],
  toastTimer: null,
};

const els = {
  sidebar: document.getElementById("sidebar"),
  sidebarOverlay: document.getElementById("sidebarOverlay"),
  menuToggleBtn: document.getElementById("menuToggleBtn"),
  menuCloseBtn: document.getElementById("menuCloseBtn"),
  navLinks: document.querySelectorAll(".nav-link"),
  views: {
    home: document.getElementById("view-home"),
    global: document.getElementById("view-global"),
    channel: document.getElementById("view-channel"),
    updates: document.getElementById("view-updates"),
  },
  syncDot: document.getElementById("syncDot"),
  syncText: document.getElementById("syncText"),
  syncSub: document.getElementById("syncSub"),
  mobileSyncBadge: document.getElementById("mobileSyncBadge"),
  updatesNavPill: document.getElementById("updatesNavPill"),
  homeStatsStrip: document.getElementById("homeStatsStrip"),
  homeGlobalIcons: document.getElementById("homeGlobalIcons"),
  homeRecentIcons: document.getElementById("homeRecentIcons"),
  homeFeaturedList: document.getElementById("homeFeaturedList"),
  globalCountBadge: document.getElementById("globalCountBadge"),
  groupToggle: document.getElementById("groupToggle"),
  layoutBtns: document.querySelectorAll(".layout-btn"),
  sortSelect: document.getElementById("sortSelect"),
  dirSelect: document.getElementById("dirSelect"),
  costSelect: document.getElementById("costSelect"),
  catSelect: document.getElementById("catSelect"),
  searchInput: document.getElementById("searchInput"),
  kbdHint: document.getElementById("kbdHint"),
  topPagination: document.getElementById("topPagination"),
  bottomPagination: document.getElementById("bottomPagination"),
  globalCollection: document.getElementById("globalCollection"),
  globalEmpty: document.getElementById("globalEmpty"),
  resetFiltersBtn: document.getElementById("resetFiltersBtn"),
  channelForm: document.getElementById("channelForm"),
  channelInput: document.getElementById("channelInput"),
  channelOutput: document.getElementById("channelOutput"),
  recheckLiveBtn: document.getElementById("recheckLiveBtn"),
  updatesStatsStrip: document.getElementById("updatesStatsStrip"),
  liveDiffBanner: document.getElementById("liveDiffBanner"),
  changelogMeta: document.getElementById("changelogMeta"),
  changelogList: document.getElementById("changelogList"),
  recentYearMeta: document.getElementById("recentYearMeta"),
  recentYearList: document.getElementById("recentYearList"),
  badgeModal: document.getElementById("badgeModal"),
  modalCloseBtn: document.getElementById("modalCloseBtn"),
  modalPreviewBox: document.getElementById("modalPreviewBox"),
  checkerToggle: document.getElementById("checkerToggle"),
  modalImg4x: document.getElementById("modalImg4x"),
  modalImg2x: document.getElementById("modalImg2x"),
  modalImg1x: document.getElementById("modalImg1x"),
  modalTags: document.getElementById("modalTags"),
  modalTitle: document.getElementById("modalTitle"),
  modalDesc: document.getElementById("modalDesc"),
  modalUsers: document.getElementById("modalUsers"),
  modalSetId: document.getElementById("modalSetId"),
  modalVersion: document.getElementById("modalVersion"),
  modalTrackedWrap: document.getElementById("modalTrackedWrap"),
  modalTracked: document.getElementById("modalTracked"),
  copySetIdBtn: document.getElementById("copySetIdBtn"),
  copyVersionBtn: document.getElementById("copyVersionBtn"),
  chatThemeToggle: document.getElementById("chatThemeToggle"),
  chatBox: document.getElementById("chatBox"),
  chatBadgeImg: document.getElementById("chatBadgeImg"),
  versionsSection: document.getElementById("versionsSection"),
  versionsCount: document.getElementById("versionsCount"),
  versionsStrip: document.getElementById("versionsStrip"),
  downloadPngBtn: document.getElementById("downloadPngBtn"),
  copyUrlBtn: document.getElementById("copyUrlBtn"),
  externalLinkBtn: document.getElementById("externalLinkBtn"),
  toast: document.getElementById("toast"),
};

function badgeKey(b) {
  return `${b.setID}::${b.version}`;
}

function classifyBadge(b) {
  const sid = (b.setID || "").toLowerCase();
  const desc = (b.description || "").trim();
  const clickUrl = b.clickURL || "";

  if (sid && (ROLE_SET_IDS.has(sid) || desc.toLowerCase().includes("twitch staff"))) {
    return "Role";
  }
  if (PLATFORM_SET_IDS.has(sid)) return "Platform";
  if (PAID_RE.test(desc)) return "Paid / Sub";
  if (WATCH_RE.test(desc)) return "Free / Watch";
  if (ACTION_RE.test(desc)) return "Action";
  if (clickUrl.includes("/directory/game/")) return "Legacy";
  return "Event";
}

function classifyCost(b, category) {
  const sid = (b.setID || "").toLowerCase();
  const desc = (b.description || "").trim();
  const action = (b.clickAction || "").toUpperCase();
  if (category === "Role") return "role";
  if (
    PAID_PLATFORM_IDS.has(sid) ||
    category === "Paid / Sub" ||
    action === "SUBSCRIBE" ||
    action === "GET_TURBO" ||
    PAID_RE.test(desc)
  ) {
    return "paid";
  }
  return "free";
}

function extractYear(b) {
  const text = [b.title, b.setID, b.description].filter(Boolean).join(" ");
  const matches = text.match(YEAR_RE);
  if (!matches) return null;
  const years = matches.map(Number).filter((y) => y >= 2010 && y <= 2035);
  return years.length ? Math.max(...years) : null;
}

function compareVersions(a, b) {
  const na = Number(a.version);
  const nb = Number(b.version);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a.version).localeCompare(String(b.version));
}

function isSafeHttpUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function formatUsers(badge) {
  if (typeof badge.userCount !== "number") return "Users: N/A";
  const count = badge.userCount.toLocaleString("en-US");
  if (typeof badge.percentage === "number" && badge.percentage >= 0.01) {
    return `Users: ${count} (${badge.percentage.toFixed(2)}%)`;
  }
  return `Users: ${count}`;
}

function formatCostLabel(cost) {
  if (cost === "paid") return "Cost: Paid";
  if (cost === "role") return "Role / System";
  return "Cost: Free";
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }) + " UTC"
  );
}

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove("hidden");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 2000);
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`Copied ${label}`);
  } catch {
    showToast("Copy failed");
  }
}

async function gqlRequest(query, variables = {}) {
  const res = await fetch(GQL_URL, {
    method: "POST",
    headers: {
      "Client-ID": TWITCH_CLIENT_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = await res.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors[0].message || "Twitch GQL error");
  }
  return payload.data;
}

function toggleSidebar(open) {
  els.sidebar.classList.toggle("is-open", open);
  els.sidebarOverlay.classList.toggle("hidden", !open);
}

function setView(viewName) {
  if (!els.views[viewName]) return;
  state.view = viewName;

  for (const btn of els.navLinks) {
    btn.classList.toggle("is-active", btn.dataset.view === viewName);
  }
  for (const [name, sec] of Object.entries(els.views)) {
    sec.classList.toggle("is-active", name === viewName);
  }

  toggleSidebar(false);
  if (window.location.hash !== `#${viewName}`) {
    history.replaceState(null, "", `#${viewName}`);
  }
  window.scrollTo({ top: 0, behavior: "instant" });
}

function createIconSvg(kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  if (kind === "users") {
    path.setAttribute("d", "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2");
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", "9");
    c.setAttribute("cy", "7");
    c.setAttribute("r", "4");
    svg.append(path, c);
    return svg;
  }
  if (kind === "cost") {
    path.setAttribute("d", "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6");
    svg.appendChild(path);
    return svg;
  }
  path.setAttribute("d", "M4 7h16M4 12h16M4 17h10");
  svg.appendChild(path);
  return svg;
}

function createBadgeRowCard(badge, siblings = [badge], tierCount = 1) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "badge-row-card";
  card.addEventListener("click", () => openBadgeModal(badge, siblings));

  // Top metadata row (StreamDatabase signature)
  const metaBar = document.createElement("div");
  metaBar.className = "row-meta-bar";

  const costPill = document.createElement("span");
  const costVal = badge.cost || "free";
  costPill.className = `meta-pill-inline is-${costVal}`;
  costPill.append(createIconSvg("cost"), document.createTextNode(formatCostLabel(costVal)));

  const usersPill = document.createElement("span");
  const hasUsers = typeof badge.userCount === "number";
  usersPill.className = `meta-pill-inline ${hasUsers ? "is-users" : "is-muted"}`;
  usersPill.append(createIconSvg("users"), document.createTextNode(formatUsers(badge)));

  const catPill = document.createElement("span");
  catPill.className = "meta-pill-inline";
  catPill.append(
    createIconSvg("cat"),
    document.createTextNode(badge.category || "Badge")
  );

  metaBar.append(costPill, usersPill, catPill);

  const rightTags = document.createElement("div");
  rightTags.className = "row-tags-right";
  if (badge.isLiveNew) {
    const t = document.createElement("span");
    t.className = "mini-tag is-new";
    t.textContent = "LIVE NEW";
    rightTags.appendChild(t);
  }
  if (badge.year) {
    const t = document.createElement("span");
    t.className = `mini-tag${badge.year === 2026 ? " is-year" : ""}`;
    t.textContent = String(badge.year);
    rightTags.appendChild(t);
  }
  if (tierCount > 1) {
    const t = document.createElement("span");
    t.className = "mini-tag";
    t.textContent = `${tierCount} TIERS`;
    rightTags.appendChild(t);
  }
  if (rightTags.childElementCount) metaBar.appendChild(rightTags);

  // Main row: icon + title + setID + description
  const mainRow = document.createElement("div");
  mainRow.className = "row-main";

  const img = document.createElement("img");
  img.className = "row-icon";
  img.src = badge.image4x || badge.image2x || badge.image1x;
  img.alt = badge.title;
  img.loading = "lazy";
  img.decoding = "async";

  const textCol = document.createElement("div");
  textCol.className = "row-text";

  const titleLine = document.createElement("div");
  titleLine.className = "row-title-line";

  const title = document.createElement("span");
  title.className = "row-title";
  title.textContent = badge.title;

  const sid = document.createElement("span");
  sid.className = "row-set-id";
  sid.textContent = badge.setID;

  titleLine.append(title, sid);
  textCol.appendChild(titleLine);

  if (badge.description && badge.description.trim()) {
    const desc = document.createElement("p");
    desc.className = "row-desc";
    desc.textContent = badge.description;
    textCol.appendChild(desc);
  }

  mainRow.append(img, textCol);
  card.append(metaBar, mainRow);
  return card;
}

function createBadgeGridCard(badge, siblings = [badge], tierCount = 1) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "badge-grid-card";
  card.addEventListener("click", () => openBadgeModal(badge, siblings));

  const top = document.createElement("div");
  top.className = "grid-card-top";

  const img = document.createElement("img");
  img.className = "grid-icon";
  img.src = badge.image4x || badge.image2x || badge.image1x;
  img.alt = badge.title;
  img.loading = "lazy";
  img.decoding = "async";
  top.appendChild(img);

  if (badge.isLiveNew) {
    const t = document.createElement("span");
    t.className = "mini-tag is-new";
    t.textContent = "LIVE";
    top.appendChild(t);
  } else if (tierCount > 1) {
    const t = document.createElement("span");
    t.className = "mini-tag";
    t.textContent = `${tierCount}x`;
    top.appendChild(t);
  } else if (badge.year === 2026) {
    const t = document.createElement("span");
    t.className = "mini-tag is-year";
    t.textContent = "2026";
    top.appendChild(t);
  }

  const title = document.createElement("div");
  title.className = "grid-title";
  title.textContent = badge.title;

  const sub = document.createElement("div");
  sub.className = "grid-sub";
  const cSpan = document.createElement("span");
  cSpan.textContent = badge.cost === "paid" ? "PAID" : badge.cost === "role" ? "ROLE" : "FREE";
  const uSpan = document.createElement("span");
  uSpan.textContent =
    typeof badge.userCount === "number"
      ? badge.userCount >= 1_000_000
        ? `${(badge.userCount / 1_000_000).toFixed(1)}M`
        : badge.userCount >= 1_000
          ? `${(badge.userCount / 1_000).toFixed(1)}K`
          : String(badge.userCount)
      : "N/A";
  sub.append(cSpan, uSpan);

  card.append(top, title, sub);
  return card;
}

function getGroupedItems(query) {
  const q = query.trim().toLowerCase();
  const matchesQ = (b) =>
    !q ||
    b.title.toLowerCase().includes(q) ||
    b.setID.toLowerCase().includes(q) ||
    (b.description || "").toLowerCase().includes(q);

  const bySet = new Map();
  for (const b of state.badges) {
    if (!bySet.has(b.setID)) bySet.set(b.setID, []);
    bySet.get(b.setID).push(b);
  }

  const items = [];
  for (const versions of bySet.values()) {
    versions.sort(compareVersions);
    const matched = versions.filter(matchesQ);
    if (!matched.length) continue;

    const rep =
      (q ? matched[0] : null) ||
      versions.find((v) => v.version === "1") ||
      versions[0];

    const maxUsers = versions.reduce(
      (max, v) => (typeof v.userCount === "number" && v.userCount > max ? v.userCount : max),
      -1
    );
    const repWithMaxUsers =
      maxUsers >= 0 && typeof rep.userCount !== "number"
        ? versions.find((v) => v.userCount === maxUsers) || rep
        : rep;

    const maxYear = versions.reduce((acc, v) => Math.max(acc, v.year || 0), 0) || null;
    items.push({
      badge: {
        ...repWithMaxUsers,
        isLiveNew: versions.some((v) => v.isLiveNew),
        year: maxYear,
      },
      siblings: versions,
      tierCount: versions.length,
    });
  }
  return items;
}

function filterAndSortGlobal() {
  const q = state.search.trim().toLowerCase();
  const matchesQ = (b) =>
    !q ||
    b.title.toLowerCase().includes(q) ||
    b.setID.toLowerCase().includes(q) ||
    (b.description || "").toLowerCase().includes(q);

  const base = state.grouped
    ? getGroupedItems(q)
    : state.badges
        .filter(matchesQ)
        .map((b) => ({
          badge: b,
          siblings: state.badges
            .filter((x) => x.setID === b.setID)
            .sort(compareVersions),
          tierCount: 1,
        }));

  const filtered = base.filter(({ badge }) => {
    if (state.cost !== "any" && badge.cost !== state.cost) return false;
    if (state.category === "2026") {
      return badge.year === 2026 || Boolean(badge.isLiveNew);
    }
    if (state.category !== "any" && badge.category !== state.category) return false;
    return true;
  });

  const mult = state.dir === "asc" ? 1 : -1;
  filtered.sort((a, b) => {
    const ba = a.badge;
    const bb = b.badge;

    if (Boolean(ba.isLiveNew) !== Boolean(bb.isLiveNew)) {
      return ba.isLiveNew ? -1 : 1;
    }
    if (state.sort === "users") {
      const ua = typeof ba.userCount === "number" ? ba.userCount : -1;
      const ub = typeof bb.userCount === "number" ? bb.userCount : -1;
      if (ua !== ub) {
        if (ua === -1) return 1;
        if (ub === -1) return -1;
        return (ua - ub) * mult;
      }
      return ba.title.localeCompare(bb.title);
    }
    if (state.sort === "recent") {
      const ya = ba.year || 0;
      const yb = bb.year || 0;
      if (ya !== yb) return (ya - yb) * mult;
      return ba.title.localeCompare(bb.title);
    }
    if (state.sort === "setID") {
      return ba.setID.localeCompare(bb.setID) * mult;
    }
    return ba.title.localeCompare(bb.title) * mult;
  });

  return filtered;
}

function renderPagination(container, totalItems, totalPages) {
  container.replaceChildren();
  if (!totalItems) return;

  const controls = document.createElement("div");
  controls.className = "pag-controls";

  if (!state.showAll && totalPages > 1) {
    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "pag-btn";
    prevBtn.textContent = "←";
    prevBtn.disabled = state.page <= 1;
    prevBtn.addEventListener("click", () => {
      state.page -= 1;
      renderGlobalList();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    const lbl = document.createElement("span");
    lbl.className = "pag-label";
    lbl.textContent = `Page ${state.page} of ${totalPages}`;

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "pag-btn";
    nextBtn.textContent = "→";
    nextBtn.disabled = state.page >= totalPages;
    nextBtn.addEventListener("click", () => {
      state.page += 1;
      renderGlobalList();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    controls.append(prevBtn, lbl, nextBtn);
  } else {
    const lbl = document.createElement("span");
    lbl.className = "pag-label";
    lbl.textContent = `Showing all ${totalItems}`;
    controls.appendChild(lbl);
  }

  const showAllBtn = document.createElement("button");
  showAllBtn.type = "button";
  showAllBtn.className = "pag-btn";
  showAllBtn.textContent = state.showAll ? "Paginate (48)" : `Show All (${totalItems})`;
  showAllBtn.addEventListener("click", () => {
    state.showAll = !state.showAll;
    state.page = 1;
    renderGlobalList();
  });

  container.append(controls, showAllBtn);
}

function renderGlobalList() {
  const items = filterAndSortGlobal();
  const unit = state.grouped ? "sets" : "badges";
  els.globalCountBadge.textContent = `${items.length} ${unit}`;

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;

  const visible = state.showAll
    ? items
    : items.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

  renderPagination(els.topPagination, items.length, totalPages);
  renderPagination(els.bottomPagination, items.length, totalPages);

  els.globalCollection.replaceChildren();
  els.globalCollection.className =
    state.layout === "grid" ? "badge-grid-view" : "badge-list";

  if (!items.length) {
    els.globalEmpty.classList.remove("hidden");
    return;
  }
  els.globalEmpty.classList.add("hidden");

  const frag = document.createDocumentFragment();
  for (const item of visible) {
    frag.appendChild(
      state.layout === "grid"
        ? createBadgeGridCard(item.badge, item.siblings, item.tierCount)
        : createBadgeRowCard(item.badge, item.siblings, item.tierCount)
    );
  }
  els.globalCollection.appendChild(frag);
}

function renderHomeView() {
  const uniqueSets = new Set(state.badges.map((b) => b.setID)).size;
  const trackedOwners = state.badges.filter((b) => typeof b.userCount === "number").length;
  const count2026 = state.badges.filter((b) => b.year === 2026).length;

  els.homeStatsStrip.replaceChildren();
  const stats = [
    ["Global Sets", String(uniqueSets)],
    ["Total Badges", String(state.badges.length)],
    ["Tracked Owners", String(trackedOwners)],
    ["2026 Releases", String(count2026)],
  ];
  for (const [label, val] of stats) {
    const c = document.createElement("div");
    c.className = "stat-card";
    const l = document.createElement("div");
    l.className = "stat-card-label";
    l.textContent = label;
    const v = document.createElement("div");
    v.className = "stat-card-value";
    v.textContent = val;
    c.append(l, v);
    els.homeStatsStrip.appendChild(c);
  }

  // Preview icons for Global card
  const iconicIds = ["staff", "partner", "vip", "turbo", "premium", "verified"];
  const iconicBadges = iconicIds
    .map((id) => state.badges.find((b) => b.setID === id))
    .filter(Boolean);
  els.homeGlobalIcons.replaceChildren();
  for (const b of iconicBadges.slice(0, 6)) {
    const img = document.createElement("img");
    img.src = b.image4x || b.image2x;
    img.alt = b.title;
    img.width = 34;
    img.height = 34;
    els.homeGlobalIcons.appendChild(img);
  }

  // Preview icons for 2026 Updates card
  const recent2026 = state.badges.filter((b) => b.year === 2026).slice(0, 6);
  els.homeRecentIcons.replaceChildren();
  for (const b of recent2026) {
    const img = document.createElement("img");
    img.src = b.image4x || b.image2x;
    img.alt = b.title;
    img.width = 34;
    img.height = 34;
    els.homeRecentIcons.appendChild(img);
  }

  // Featured list: Top 4 most owned + Top 4 2026 badges
  const topOwned = state.badges
    .filter((b) => typeof b.userCount === "number")
    .slice()
    .sort((a, b) => b.userCount - a.userCount)
    .slice(0, 4);
  const latest = state.badges
    .filter((b) => b.year === 2026 && !topOwned.some((t) => t.setID === b.setID))
    .slice(0, 4);

  els.homeFeaturedList.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const b of [...topOwned, ...latest]) {
    const siblings = state.badges.filter((x) => x.setID === b.setID).sort(compareVersions);
    frag.appendChild(createBadgeRowCard(b, siblings, siblings.length));
  }
  els.homeFeaturedList.appendChild(frag);
}

function renderUpdatesView() {
  const uniqueSets = new Set(state.badges.map((b) => b.setID)).size;
  const year2026 = state.badges.filter((b) => b.year === 2026);

  els.updatesStatsStrip.replaceChildren();
  const cards = [
    ["Global Sets", String(uniqueSets)],
    ["Total Versions", String(state.badges.length)],
    ["2026 Releases", String(year2026.length)],
    ["Last Sync", formatDateTime(state.syncedAt)],
  ];
  for (const [label, value] of cards) {
    const c = document.createElement("div");
    c.className = "stat-card";
    const l = document.createElement("div");
    l.className = "stat-card-label";
    l.textContent = label;
    const v = document.createElement("div");
    v.className = "stat-card-value";
    v.textContent = value;
    c.append(l, v);
    els.updatesStatsStrip.appendChild(c);
  }

  if (state.liveAdded.length || state.liveRemovedCount) {
    els.liveDiffBanner.classList.remove("hidden");
    els.liveDiffBanner.textContent = `Live Twitch diff: +${state.liveAdded.length} new badge(s), ${state.liveRemovedCount} removed since last snapshot.`;
  } else {
    els.liveDiffBanner.classList.add("hidden");
  }

  const combined = [
    ...state.liveAdded.map((b) => ({ ...b, isLive: true })),
    ...state.changelog.map((ev) => {
      const full = state.badges.find(
        (x) => x.setID === ev.setID && String(x.version) === String(ev.version)
      );
      return (
        full || {
          setID: ev.setID,
          version: ev.version || "1",
          title: ev.title || ev.setID,
          description: ev.description || `${ev.type} at ${formatDateTime(ev.timestamp)}`,
          category: ev.category || "Event",
          cost: ev.cost || "free",
          image2x: ev.image2x || "logo.png?v=2",
          image4x: ev.image2x || "logo.png?v=2",
          isLiveNew: ev.type === "added",
        }
      );
    }),
  ];

  els.changelogMeta.textContent = `${combined.length} events`;
  els.changelogList.replaceChildren();

  if (!combined.length) {
    const box = document.createElement("div");
    box.className = "empty-box";
    const t = document.createElement("p");
    t.className = "empty-title";
    t.textContent = "Automated badge tracking active";
    const s = document.createElement("p");
    s.className = "empty-sub";
    s.textContent =
      "Snapshots run every 2 hours via GitHub Actions. Newly added, updated, or removed Twitch badges will appear here automatically.";
    box.append(t, s);
    els.changelogList.appendChild(box);
  } else {
    const frag = document.createDocumentFragment();
    for (const b of combined.slice(0, 60)) {
      const siblings = state.badges.filter((x) => x.setID === b.setID).sort(compareVersions);
      frag.appendChild(createBadgeRowCard(b, siblings, siblings.length));
    }
    els.changelogList.appendChild(frag);
  }

  const sorted2026 = year2026
    .slice()
    .sort((a, b) => (b.userCount || 0) - (a.userCount || 0) || a.title.localeCompare(b.title));
  els.recentYearMeta.textContent = `${sorted2026.length} badges`;
  els.recentYearList.replaceChildren();
  const yFrag = document.createDocumentFragment();
  for (const b of sorted2026) {
    const siblings = state.badges.filter((x) => x.setID === b.setID).sort(compareVersions);
    yFrag.appendChild(createBadgeRowCard(b, siblings, 1));
  }
  els.recentYearList.appendChild(yFrag);
}

function renderChannelMessage(titleText, subText = "") {
  const box = document.createElement("div");
  box.className = "empty-box";
  const t = document.createElement("p");
  t.className = "empty-title";
  t.textContent = titleText;
  box.appendChild(t);
  if (subText) {
    const s = document.createElement("p");
    s.className = "empty-sub";
    s.textContent = subText;
    box.appendChild(s);
  }
  els.channelOutput.replaceChildren(box);
}

async function lookupChannel(rawLogin) {
  const login = rawLogin.trim().toLowerCase().replace(/^@/, "");
  if (!login) return;
  els.channelInput.value = login;
  renderChannelMessage(`Looking up @${login}...`);

  try {
    const data = await gqlRequest(
      `query ChannelBadges($login: String!) {
        user(login: $login) {
          id
          login
          displayName
          profileImageURL(width: 70)
          broadcastBadges {
            setID
            version
            title
            description
            image1x: imageURL(size: NORMAL)
            image2x: imageURL(size: DOUBLE)
            image4x: imageURL(size: QUADRUPLE)
          }
        }
      }`,
      { login }
    );

    const user = data?.user;
    if (!user) {
      renderChannelMessage("Channel not found", `No Twitch channel exists for "${login}".`);
      return;
    }

    const badges = (user.broadcastBadges || []).map((b) => ({
      ...b,
      category: b.setID === "subscriber" ? "Subscriber" : "Channel Bits",
      cost: "paid",
      userCount: null,
      year: null,
      firstSeen: null,
    }));

    els.channelOutput.replaceChildren();

    const card = document.createElement("div");
    card.className = "channel-card";
    if (user.profileImageURL) {
      const av = document.createElement("img");
      av.className = "channel-avatar";
      av.src = user.profileImageURL;
      av.alt = user.displayName;
      card.appendChild(av);
    }
    const info = document.createElement("div");
    const h = document.createElement("h2");
    h.textContent = user.displayName || user.login;
    const p = document.createElement("p");
    p.className = "page-sub";
    p.textContent = `${badges.length} custom badges · @${user.login}`;
    info.append(h, p);
    card.appendChild(info);
    els.channelOutput.appendChild(card);

    if (!badges.length) {
      renderChannelMessage(
        "No custom badges",
        "This channel has no custom subscriber or bit badges."
      );
      return;
    }

    const subBadges = badges.filter((b) => b.setID === "subscriber").sort(compareVersions);
    const bitBadges = badges.filter((b) => b.setID !== "subscriber").sort(compareVersions);

    const renderGroup = (title, list) => {
      if (!list.length) return;
      const block = document.createElement("div");
      block.className = "section-block";
      const head = document.createElement("div");
      head.className = "section-head";
      const h2 = document.createElement("h2");
      h2.textContent = `${title} (${list.length})`;
      head.appendChild(h2);
      const wrap = document.createElement("div");
      wrap.className = "badge-list";
      for (const b of list) {
        wrap.appendChild(createBadgeRowCard(b, list, 1));
      }
      block.append(head, wrap);
      els.channelOutput.appendChild(block);
    };

    renderGroup("Subscriber Badges", subBadges);
    renderGroup("Bit & Cheer Badges", bitBadges);
  } catch (err) {
    renderChannelMessage("Lookup failed", err?.message || "Could not reach Twitch.");
  }
}

function openBadgeModal(badge, siblings = [badge]) {
  state.activeModalBadge = badge;
  state.activeModalSiblings = siblings.length ? siblings : [badge];

  els.modalImg4x.src = badge.image4x || badge.image2x || badge.image1x;
  els.modalImg4x.alt = badge.title;
  els.modalImg2x.src = badge.image2x || badge.image4x || badge.image1x;
  els.modalImg2x.alt = badge.title;
  els.modalImg1x.src = badge.image1x || badge.image2x || badge.image4x;
  els.modalImg1x.alt = badge.title;
  els.chatBadgeImg.src = badge.image2x || badge.image1x || badge.image4x;
  els.chatBadgeImg.alt = badge.title;

  els.modalTags.replaceChildren();
  const cTag = document.createElement("span");
  cTag.className = "mini-tag";
  cTag.textContent = (badge.cost || "free").toUpperCase();
  els.modalTags.appendChild(cTag);

  const catTag = document.createElement("span");
  catTag.className = "mini-tag";
  catTag.textContent = badge.category || "Badge";
  els.modalTags.appendChild(catTag);

  if (badge.isLiveNew) {
    const lTag = document.createElement("span");
    lTag.className = "mini-tag is-new";
    lTag.textContent = "LIVE NEW";
    els.modalTags.appendChild(lTag);
  } else if (badge.year) {
    const yTag = document.createElement("span");
    yTag.className = `mini-tag${badge.year === 2026 ? " is-year" : ""}`;
    yTag.textContent = String(badge.year);
    els.modalTags.appendChild(yTag);
  }

  els.modalTitle.textContent = badge.title;
  els.modalDesc.textContent =
    badge.description && badge.description.trim()
      ? badge.description
      : "No official description provided by Twitch.";

  els.modalUsers.textContent =
    typeof badge.userCount === "number"
      ? `${badge.userCount.toLocaleString("en-US")}${
          typeof badge.percentage === "number" && badge.percentage >= 0.01
            ? ` (${badge.percentage.toFixed(2)}%)`
            : ""
        }`
      : "N/A";
  els.modalSetId.textContent = badge.setID;
  els.modalVersion.textContent = String(badge.version);

  if (badge.firstSeen) {
    els.modalTrackedWrap.classList.remove("hidden");
    els.modalTracked.textContent = formatDate(badge.firstSeen);
  } else {
    els.modalTrackedWrap.classList.add("hidden");
  }

  if (isSafeHttpUrl(badge.clickURL)) {
    els.externalLinkBtn.href = badge.clickURL;
    els.externalLinkBtn.classList.remove("hidden");
  } else {
    els.externalLinkBtn.classList.add("hidden");
  }

  if (state.activeModalSiblings.length > 1) {
    els.versionsSection.classList.remove("hidden");
    els.versionsCount.textContent = `${state.activeModalSiblings.length} tiers`;
    els.versionsStrip.replaceChildren();
    for (const ver of state.activeModalSiblings) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `version-pill${
        String(ver.version) === String(badge.version) ? " is-active" : ""
      }`;
      const img = document.createElement("img");
      img.src = ver.image2x || ver.image1x;
      img.alt = ver.title;
      img.width = 18;
      img.height = 18;
      const lbl = document.createElement("span");
      lbl.textContent = `v${ver.version}`;
      btn.append(img, lbl);
      btn.addEventListener("click", () =>
        openBadgeModal(ver, state.activeModalSiblings)
      );
      els.versionsStrip.appendChild(btn);
    }
  } else {
    els.versionsSection.classList.add("hidden");
  }

  els.badgeModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeBadgeModal() {
  els.badgeModal.classList.add("hidden");
  document.body.style.overflow = "";
}

async function downloadBadgePng() {
  const b = state.activeModalBadge;
  if (!b) return;
  const url = b.image4x || b.image2x || b.image1x;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = `${b.setID}-v${b.version}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
    showToast("Downloaded PNG");
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function updateSyncStatus(isLive) {
  const sets = new Set(state.badges.map((b) => b.setID)).size;
  const dotClass = isLive ? "sync-dot is-live" : "sync-dot is-snapshot";
  els.syncDot.className = dotClass;
  const mobileDot = els.mobileSyncBadge.querySelector(".sync-dot");
  if (mobileDot) mobileDot.className = dotClass;

  els.syncText.textContent = isLive ? "Live · Twitch GQL" : "Snapshot Loaded";
  els.syncSub.textContent = `${sets} sets · ${state.badges.length} badges`;
}

async function syncLiveBadges() {
  try {
    const data = await gqlRequest(`query GlobalBadges {
      badges {
        setID
        version
        title
        description
        image1x: imageURL(size: NORMAL)
        image2x: imageURL(size: DOUBLE)
        image4x: imageURL(size: QUADRUPLE)
        clickAction
        clickURL
      }
    }`);

    const raw = data?.badges;
    if (!Array.isArray(raw) || !raw.length) return;

    state.liveConnected = true;
    const byKey = new Map(state.badges.map((b) => [badgeKey(b), b]));
    const liveKeys = new Set();
    const added = [];
    const merged = [];

    for (const item of raw) {
      const k = badgeKey(item);
      liveKeys.add(k);
      const existing = byKey.get(k);
      if (existing) {
        merged.push({
          ...existing,
          title: (item.title || item.setID).trim(),
          description: (item.description || "").trim(),
          image1x: item.image1x,
          image2x: item.image2x,
          image4x: item.image4x,
          clickAction: item.clickAction,
          clickURL: item.clickURL,
        });
      } else {
        const category = classifyBadge(item);
        const newEntry = {
          setID: item.setID,
          version: String(item.version),
          title: (item.title || item.setID).trim(),
          description: (item.description || "").trim(),
          category,
          cost: classifyCost(item, category),
          year: extractYear(item),
          userCount: null,
          percentage: null,
          image1x: item.image1x,
          image2x: item.image2x,
          image4x: item.image4x,
          clickAction: item.clickAction,
          clickURL: item.clickURL,
          firstSeen: new Date().toISOString(),
          isInitialSeed: false,
          isLiveNew: true,
        };
        added.push(newEntry);
        merged.push(newEntry);
      }
    }

    state.badges = merged;
    state.liveAdded = added;
    state.liveRemovedCount = [...state.snapshotKeys].filter((k) => !liveKeys.has(k)).length;
    if (added.length) {
      els.updatesNavPill.textContent = `+${added.length} LIVE`;
    }

    updateSyncStatus(true);
    renderHomeView();
    renderGlobalList();
    renderUpdatesView();
  } catch {
    if (!state.liveConnected) updateSyncStatus(false);
  }
}

async function init() {
  const hash = window.location.hash.replace("#", "");
  if (els.views[hash]) setView(hash);

  try {
    const [badgesRes, changelogRes] = await Promise.all([
      fetch("./data/badges.json"),
      fetch("./data/changelog.json").catch(() => null),
    ]);
    if (badgesRes.ok) {
      const doc = await badgesRes.json();
      state.badges = doc.badges || [];
      state.syncedAt = doc.syncedAt || null;
      state.snapshotKeys = new Set(state.badges.map(badgeKey));
    }
    if (changelogRes?.ok) {
      const cl = await changelogRes.json();
      state.changelog = cl.events || [];
    }
  } catch {
    // Live Twitch GQL still loads badges
  }

  updateSyncStatus(false);
  renderHomeView();
  renderGlobalList();
  renderUpdatesView();
  syncLiveBadges();
}

// Navigation & Drawer Events
els.menuToggleBtn.addEventListener("click", () => toggleSidebar(true));
els.menuCloseBtn.addEventListener("click", () => toggleSidebar(false));
els.sidebarOverlay.addEventListener("click", () => toggleSidebar(false));

for (const btn of els.navLinks) {
  btn.addEventListener("click", () => setView(btn.dataset.view));
}

for (const btn of document.querySelectorAll("[data-goto]")) {
  btn.addEventListener("click", () => setView(btn.dataset.goto));
}

for (const link of document.querySelectorAll("[data-nav]")) {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    setView(link.dataset.nav);
  });
}

// Global Filter Events
for (const btn of els.layoutBtns) {
  btn.addEventListener("click", () => {
    state.layout = btn.dataset.layout;
    for (const b of els.layoutBtns) {
      b.classList.toggle("is-active", b === btn);
    }
    renderGlobalList();
  });
}

els.groupToggle.addEventListener("change", (e) => {
  state.grouped = e.target.checked;
  state.page = 1;
  renderGlobalList();
});

els.sortSelect.addEventListener("change", (e) => {
  state.sort = e.target.value;
  state.page = 1;
  renderGlobalList();
});

els.dirSelect.addEventListener("change", (e) => {
  state.dir = e.target.value;
  state.page = 1;
  renderGlobalList();
});

els.costSelect.addEventListener("change", (e) => {
  state.cost = e.target.value;
  state.page = 1;
  renderGlobalList();
});

els.catSelect.addEventListener("change", (e) => {
  state.category = e.target.value;
  state.page = 1;
  renderGlobalList();
});

els.searchInput.addEventListener("input", (e) => {
  state.search = e.target.value;
  state.page = 1;
  els.kbdHint.classList.toggle("hidden", state.search.length > 0);
  renderGlobalList();
});

els.resetFiltersBtn.addEventListener("click", () => {
  state.cost = "any";
  state.category = "any";
  state.search = "";
  state.page = 1;
  els.costSelect.value = "any";
  els.catSelect.value = "any";
  els.searchInput.value = "";
  els.kbdHint.classList.remove("hidden");
  renderGlobalList();
});

// Updates & Channel Events
els.recheckLiveBtn.addEventListener("click", async () => {
  els.recheckLiveBtn.disabled = true;
  els.recheckLiveBtn.textContent = "Checking...";
  await syncLiveBadges();
  els.recheckLiveBtn.disabled = false;
  els.recheckLiveBtn.textContent = "Check Live Now";
  showToast("Checked live Twitch badges");
});

els.channelForm.addEventListener("submit", (e) => {
  e.preventDefault();
  lookupChannel(els.channelInput.value);
});

for (const chip of document.querySelectorAll(".quick-chip")) {
  chip.addEventListener("click", () => lookupChannel(chip.dataset.channel));
}

// Modal Events
els.modalCloseBtn.addEventListener("click", closeBadgeModal);
els.badgeModal.addEventListener("click", (e) => {
  if (e.target === els.badgeModal) closeBadgeModal();
});

els.checkerToggle.addEventListener("click", () => {
  els.modalPreviewBox.classList.toggle("is-checker");
  els.checkerToggle.classList.toggle("is-active");
});

els.chatThemeToggle.addEventListener("click", () => {
  const isLight = els.chatBox.classList.toggle("is-light");
  els.chatThemeToggle.classList.toggle("is-active", isLight);
  els.chatThemeToggle.textContent = isLight ? "Dark chat" : "Light chat";
});

els.copySetIdBtn.addEventListener("click", () => {
  if (state.activeModalBadge) copyText(state.activeModalBadge.setID, "Set ID");
});

els.copyVersionBtn.addEventListener("click", () => {
  if (state.activeModalBadge) copyText(String(state.activeModalBadge.version), "Version");
});

els.copyUrlBtn.addEventListener("click", () => {
  if (state.activeModalBadge) {
    copyText(
      state.activeModalBadge.image4x || state.activeModalBadge.image2x,
      "Image URL"
    );
  }
});

els.downloadPngBtn.addEventListener("click", downloadBadgePng);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.badgeModal.classList.contains("hidden")) {
    closeBadgeModal();
    return;
  }
  if (
    e.key === "/" &&
    state.view === "global" &&
    els.badgeModal.classList.contains("hidden") &&
    document.activeElement?.tagName !== "INPUT"
  ) {
    e.preventDefault();
    els.searchInput.focus();
  }
});

init();
