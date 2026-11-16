const GQL_URL = "https://gql.twitch.tv/gql";
const TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

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

const PAID_RE =
  /\b(sub|subbed|subbing|subscribe|subscribed|subscribing|gift|gifted|gifting|bits|cheer|cheered|cheering|support|supported|supporting|purchas\w*|turbo|tier)\b/i;
const WATCH_RE =
  /\b(watch|watched|watching|view|viewed|viewing|tuned in|drop|drops|livestream|premiere)\b/i;
const ACTION_RE =
  /\b(clip|clipped|clipping|chat|chatted|chatting|vote|voted|voting|quest|campaign|creator|raid|share|shared|sharing)\b/i;
const YEAR_RE = /\b(20\d{2})\b/g;

const CATEGORY_ORDER = [
  "All",
  "2026",
  "Free / Watch",
  "Paid / Sub",
  "Action",
  "Platform",
  "Role",
  "Event",
  "Legacy",
];

const state = {
  view: "global",
  badges: [],
  snapshotKeys: new Set(),
  liveAdded: [],
  liveRemovedCount: 0,
  changelog: [],
  syncedAt: null,
  liveConnected: false,
  category: "All",
  search: "",
  sort: "recent",
  grouped: true,
  activeModalBadge: null,
  activeModalSiblings: [],
  toastTimer: null,
};

const els = {
  navTabs: document.querySelectorAll(".nav-tab"),
  views: {
    global: document.getElementById("view-global"),
    updates: document.getElementById("view-updates"),
    channel: document.getElementById("view-channel"),
  },
  syncDot: document.getElementById("syncDot"),
  syncText: document.getElementById("syncText"),
  globalStats: document.getElementById("globalStats"),
  searchInput: document.getElementById("searchInput"),
  kbdHint: document.getElementById("kbdHint"),
  groupToggle: document.getElementById("groupToggle"),
  sortSelect: document.getElementById("sortSelect"),
  categoryFilters: document.getElementById("categoryFilters"),
  resultsMeta: document.getElementById("resultsMeta"),
  badgeGrid: document.getElementById("badgeGrid"),
  globalEmpty: document.getElementById("globalEmpty"),
  resetFiltersBtn: document.getElementById("resetFiltersBtn"),
  recheckLiveBtn: document.getElementById("recheckLiveBtn"),
  updatesSummary: document.getElementById("updatesSummary"),
  liveDiffBanner: document.getElementById("liveDiffBanner"),
  changelogMeta: document.getElementById("changelogMeta"),
  changelogList: document.getElementById("changelogList"),
  recentYearMeta: document.getElementById("recentYearMeta"),
  recentYearGrid: document.getElementById("recentYearGrid"),
  channelForm: document.getElementById("channelForm"),
  channelInput: document.getElementById("channelInput"),
  channelOutput: document.getElementById("channelOutput"),
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
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }) + " UTC";
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 2000);
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

function setView(viewName) {
  if (!els.views[viewName]) return;
  state.view = viewName;

  for (const tab of els.navTabs) {
    tab.classList.toggle("is-active", tab.dataset.view === viewName);
  }
  for (const [name, section] of Object.entries(els.views)) {
    section.classList.toggle("is-active", name === viewName);
  }

  if (window.location.hash !== `#${viewName}`) {
    history.replaceState(null, "", `#${viewName}`);
  }
}

function getGroupedBadgeItems(query = "") {
  const q = query.trim().toLowerCase();
  const matchesQuery = (b) =>
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
    const matchedVersions = versions.filter(matchesQuery);
    if (!matchedVersions.length) continue;

    const rep =
      (q ? matchedVersions[0] : null) ||
      versions.find((v) => v.version === "1") ||
      versions[0];

    const hasLiveNew = versions.some((v) => v.isLiveNew);
    const maxYear =
      versions.reduce((acc, v) => Math.max(acc, v.year || 0), 0) || null;

    items.push({
      badge: { ...rep, isLiveNew: hasLiveNew, year: maxYear },
      siblings: versions,
      tierCount: versions.length,
    });
  }
  return items;
}

function buildDisplayItems() {
  const query = state.search.trim().toLowerCase();
  const matchesQuery = (b) =>
    !query ||
    b.title.toLowerCase().includes(query) ||
    b.setID.toLowerCase().includes(query) ||
    (b.description || "").toLowerCase().includes(query);

  if (!state.grouped) {
    return state.badges
      .filter((b) => matchesCategory(b) && matchesQuery(b))
      .map((b) => ({
        badge: b,
        siblings: state.badges
          .filter((x) => x.setID === b.setID)
          .sort(compareVersions),
        tierCount: 1,
      }));
  }

  return getGroupedBadgeItems(query).filter((item) =>
    matchesCategory(item.badge)
  );
}

function matchesCategory(b) {
  if (state.category === "All") return true;
  if (state.category === "2026") return b.year === 2026 || Boolean(b.isLiveNew);
  return b.category === state.category;
}

function sortDisplayItems(items) {
  const mode = state.sort;
  return items.slice().sort((a, b) => {
    if (mode === "az") {
      return a.badge.title.localeCompare(b.badge.title);
    }
    if (mode === "za") {
      return b.badge.title.localeCompare(a.badge.title);
    }
    if (mode === "tiers") {
      return b.tierCount - a.tierCount || a.badge.title.localeCompare(b.badge.title);
    }
    // "recent": Live new first, then explicit year desc, then post-seed firstSeen, then title
    if (Boolean(a.badge.isLiveNew) !== Boolean(b.badge.isLiveNew)) {
      return a.badge.isLiveNew ? -1 : 1;
    }
    const ya = a.badge.year || 0;
    const yb = b.badge.year || 0;
    if (ya !== yb) return yb - ya;
    const seedA = a.badge.isInitialSeed ? 0 : 1;
    const seedB = b.badge.isInitialSeed ? 0 : 1;
    if (seedA !== seedB) return seedB - seedA;
    return a.badge.title.localeCompare(b.badge.title);
  });
}

function computeCategoryCounts() {
  const counts = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0]));
  const source = state.grouped
    ? getGroupedBadgeItems("").map((item) => item.badge)
    : state.badges;

  for (const b of source) {
    counts.All += 1;
    if (b.year === 2026 || b.isLiveNew) counts["2026"] += 1;
    if (counts[b.category] !== undefined) counts[b.category] += 1;
  }
  return counts;
}

function renderFilters() {
  const counts = computeCategoryCounts();
  els.categoryFilters.replaceChildren();

  for (const cat of CATEGORY_ORDER) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `filter-pill${state.category === cat ? " is-active" : ""}`;
    btn.role = "tab";
    btn.setAttribute("aria-selected", String(state.category === cat));

    const label = document.createElement("span");
    label.textContent = cat;
    const count = document.createElement("span");
    count.className = "pill-count";
    count.textContent = String(counts[cat] ?? 0);

    btn.append(label, count);
    btn.addEventListener("click", () => {
      state.category = cat;
      renderFilters();
      renderGlobalGrid();
    });
    els.categoryFilters.appendChild(btn);
  }
}

function createBadgeCard(badge, siblings = [badge], tierCount = 1) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "badge-card";
  card.addEventListener("click", () => openBadgeModal(badge, siblings));

  const top = document.createElement("div");
  top.className = "badge-card-top";

  const iconWrap = document.createElement("div");
  iconWrap.className = "badge-icon-wrap";
  const img = document.createElement("img");
  img.src = badge.image4x || badge.image2x || badge.image1x;
  img.alt = badge.title;
  img.loading = "lazy";
  img.decoding = "async";
  iconWrap.appendChild(img);
  top.appendChild(iconWrap);

  if (badge.isLiveNew) {
    const tag = document.createElement("span");
    tag.className = "card-tag is-new";
    tag.textContent = "LIVE NEW";
    top.appendChild(tag);
  } else if (tierCount > 1) {
    const tag = document.createElement("span");
    tag.className = "card-tag";
    tag.textContent = `${tierCount} tiers`;
    top.appendChild(tag);
  } else if (badge.year === 2026) {
    const tag = document.createElement("span");
    tag.className = "card-tag is-year";
    tag.textContent = "2026";
    top.appendChild(tag);
  }

  const title = document.createElement("div");
  title.className = "badge-title";
  title.textContent = badge.title;

  const meta = document.createElement("div");
  meta.className = "badge-meta-row";
  const sid = document.createElement("span");
  sid.className = "badge-set-id";
  sid.textContent = badge.setID;
  const cat = document.createElement("span");
  cat.className = "badge-cat";
  cat.textContent = badge.category || "";

  meta.append(sid, cat);
  card.append(top, title, meta);
  return card;
}

function renderGlobalGrid() {
  const items = sortDisplayItems(buildDisplayItems());
  const uniqueSets = new Set(state.badges.map((b) => b.setID)).size;

  els.globalStats.replaceChildren();
  const s1 = document.createElement("div");
  s1.className = "stat-chip";
  s1.innerHTML = `<strong>${uniqueSets}</strong> sets`;
  const s2 = document.createElement("div");
  s2.className = "stat-chip";
  s2.innerHTML = `<strong>${state.badges.length}</strong> badges`;
  els.globalStats.append(s1, s2);

  const unit = state.grouped ? "badge sets" : "badges";
  els.resultsMeta.textContent = `Showing ${items.length} ${unit}`;

  els.badgeGrid.replaceChildren();
  if (!items.length) {
    els.globalEmpty.classList.remove("hidden");
    return;
  }
  els.globalEmpty.classList.add("hidden");

  const frag = document.createDocumentFragment();
  for (const item of items) {
    frag.appendChild(createBadgeCard(item.badge, item.siblings, item.tierCount));
  }
  els.badgeGrid.appendChild(frag);
}

function renderUpdatesView() {
  const uniqueSets = new Set(state.badges.map((b) => b.setID)).size;
  const year2026 = state.badges.filter((b) => b.year === 2026);

  els.updatesSummary.replaceChildren();
  const cards = [
    ["Unique Sets", String(uniqueSets)],
    ["Total Versions", String(state.badges.length)],
    ["2026 Releases", String(year2026.length)],
    ["Snapshot Sync", formatDateTime(state.syncedAt)],
  ];
  for (const [label, value] of cards) {
    const c = document.createElement("div");
    c.className = "summary-card";
    const l = document.createElement("div");
    l.className = "summary-label";
    l.textContent = label;
    const v = document.createElement("div");
    v.className = "summary-value";
    v.textContent = value;
    c.append(l, v);
    els.updatesSummary.appendChild(c);
  }

  if (state.liveAdded.length || state.liveRemovedCount) {
    els.liveDiffBanner.classList.remove("hidden");
    els.liveDiffBanner.textContent = `Live Twitch diff: +${state.liveAdded.length} new badge(s) detected, ${state.liveRemovedCount} removed since last snapshot.`;
  } else {
    els.liveDiffBanner.classList.add("hidden");
  }

  const combinedEvents = [
    ...state.liveAdded.map((b) => ({
      type: "added",
      timestamp: new Date().toISOString(),
      setID: b.setID,
      version: b.version,
      title: b.title,
      description: b.description || "Detected live from Twitch GQL",
      image2x: b.image2x,
      isLive: true,
    })),
    ...state.changelog,
  ];

  els.changelogMeta.textContent = `${combinedEvents.length} recorded`;
  els.changelogList.replaceChildren();

  if (!combinedEvents.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <p class="empty-title">Live tracker active</p>
      <p class="empty-sub">Automated snapshots run every 2 hours. Any newly added, updated, or removed Twitch badges will appear here automatically.</p>
    `;
    els.changelogList.appendChild(empty);
  } else {
    const frag = document.createDocumentFragment();
    for (const ev of combinedEvents.slice(0, 60)) {
      const row = document.createElement("div");
      row.className = "changelog-item";
      row.addEventListener("click", () => {
        const match = state.badges.find(
          (b) => b.setID === ev.setID && String(b.version) === String(ev.version)
        );
        if (match) {
          const siblings = state.badges
            .filter((b) => b.setID === match.setID)
            .sort(compareVersions);
          openBadgeModal(match, siblings);
        }
      });

      const img = document.createElement("img");
      img.src = ev.image2x || "logo.png?v=1";
      img.alt = ev.title || ev.setID;

      const body = document.createElement("div");
      body.className = "changelog-body";
      const t = document.createElement("div");
      t.className = "changelog-title";
      t.textContent = `${ev.title || ev.setID} (v${ev.version})`;
      const s = document.createElement("div");
      s.className = "changelog-sub";
      s.textContent = ev.isLive
        ? `Detected live now · ${ev.setID}`
        : `${formatDateTime(ev.timestamp)} · ${ev.setID}`;
      body.append(t, s);

      const pill = document.createElement("span");
      pill.className = `event-badge ${ev.type || "added"}`;
      pill.textContent = ev.isLive ? "live new" : ev.type || "added";

      row.append(img, body, pill);
      frag.appendChild(row);
    }
    els.changelogList.appendChild(frag);
  }

  // Render 2026 Releases grid
  const sorted2026 = year2026.slice().sort((a, b) => a.title.localeCompare(b.title));
  els.recentYearMeta.textContent = `${sorted2026.length} badges`;
  els.recentYearGrid.replaceChildren();
  const yearFrag = document.createDocumentFragment();
  for (const b of sorted2026) {
    const siblings = state.badges.filter((x) => x.setID === b.setID).sort(compareVersions);
    yearFrag.appendChild(createBadgeCard(b, siblings, 1));
  }
  els.recentYearGrid.appendChild(yearFrag);
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
  const catTag = document.createElement("span");
  catTag.className = "card-tag";
  catTag.textContent = badge.category || "Badge";
  els.modalTags.appendChild(catTag);

  if (badge.isLiveNew) {
    const liveTag = document.createElement("span");
    liveTag.className = "card-tag is-new";
    liveTag.textContent = "LIVE NEW";
    els.modalTags.appendChild(liveTag);
  } else if (badge.year) {
    const yearTag = document.createElement("span");
    yearTag.className = "card-tag is-year";
    yearTag.textContent = String(badge.year);
    els.modalTags.appendChild(yearTag);
  }

  els.modalTitle.textContent = badge.title;
  els.modalDesc.textContent =
    badge.description && badge.description.trim()
      ? badge.description
      : "No official description provided by Twitch.";
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
    els.versionsCount.textContent = `${state.activeModalSiblings.length} versions`;
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

function renderChannelMessage(titleText, subText = "") {
  const box = document.createElement("div");
  box.className = "empty-state";
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
      renderChannelMessage(
        "Channel not found",
        `No Twitch channel exists for "${login}".`
      );
      return;
    }

    const badges = (user.broadcastBadges || []).map((b) => ({
      ...b,
      category: b.setID === "subscriber" ? "Subscriber" : "Channel Bits",
      year: null,
      firstSeen: null,
    }));

    els.channelOutput.replaceChildren();

    const header = document.createElement("div");
    header.className = "channel-header-card";
    if (user.profileImageURL) {
      const avatar = document.createElement("img");
      avatar.className = "channel-avatar";
      avatar.src = user.profileImageURL;
      avatar.alt = user.displayName;
      header.appendChild(avatar);
    }
    const info = document.createElement("div");
    const nameEl = document.createElement("h2");
    nameEl.textContent = user.displayName || user.login;
    const subEl = document.createElement("p");
    subEl.className = "subtitle";
    subEl.textContent = `${badges.length} custom channel badges · @${user.login}`;
    info.append(nameEl, subEl);
    header.appendChild(info);
    els.channelOutput.appendChild(header);

    if (!badges.length) {
      renderChannelMessage(
        "No custom badges",
        "This channel has no custom subscriber or bit badges configured."
      );
      return;
    }

    const subBadges = badges
      .filter((b) => b.setID === "subscriber")
      .sort(compareVersions);
    const otherBadges = badges
      .filter((b) => b.setID !== "subscriber")
      .sort(compareVersions);

    const renderGroup = (heading, list) => {
      if (!list.length) return;
      const group = document.createElement("div");
      group.className = "channel-group";
      const h = document.createElement("h3");
      h.className = "channel-group-title";
      h.textContent = `${heading} (${list.length})`;
      const grid = document.createElement("div");
      grid.className = "badge-grid";
      for (const b of list) {
        grid.appendChild(createBadgeCard(b, list, 1));
      }
      group.append(h, grid);
      els.channelOutput.appendChild(group);
    };

    renderGroup("Subscriber Badges", subBadges);
    renderGroup("Bit & Cheer Badges", otherBadges);
  } catch (err) {
    renderChannelMessage(
      "Lookup failed",
      err?.message || "Could not reach Twitch."
    );
  }
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
        const newEntry = {
          setID: item.setID,
          version: String(item.version),
          title: (item.title || item.setID).trim(),
          description: (item.description || "").trim(),
          category: classifyBadge(item),
          year: extractYear(item),
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

    const removedCount = [...state.snapshotKeys].filter((k) => !liveKeys.has(k)).length;
    state.badges = merged;
    state.liveAdded = added;
    state.liveRemovedCount = removedCount;

    const uniqueSets = new Set(state.badges.map((b) => b.setID)).size;
    els.syncDot.className = "sync-dot is-live";
    els.syncText.textContent = `Live · ${uniqueSets} sets`;

    renderFilters();
    renderGlobalGrid();
    renderUpdatesView();
  } catch {
    if (!state.liveConnected) {
      const uniqueSets = new Set(state.badges.map((b) => b.setID)).size;
      els.syncDot.className = "sync-dot is-snapshot";
      els.syncText.textContent = `Snapshot · ${uniqueSets} sets`;
    }
  }
}

async function init() {
  const initialHash = window.location.hash.replace("#", "");
  if (els.views[initialHash]) setView(initialHash);

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
    // Live Twitch GQL fallback will still populate badges
  }

  const uniqueSets = new Set(state.badges.map((b) => b.setID)).size;
  if (uniqueSets > 0) {
    els.syncDot.className = "sync-dot is-snapshot";
    els.syncText.textContent = `Snapshot · ${uniqueSets} sets`;
  }

  renderFilters();
  renderGlobalGrid();
  renderUpdatesView();
  syncLiveBadges();
}

// Event Wiring
for (const tab of els.navTabs) {
  tab.addEventListener("click", () => setView(tab.dataset.view));
}

document.getElementById("brandHome").addEventListener("click", (e) => {
  e.preventDefault();
  setView("global");
});

els.searchInput.addEventListener("input", (e) => {
  state.search = e.target.value;
  els.kbdHint.classList.toggle("hidden", state.search.length > 0);
  renderGlobalGrid();
});

els.groupToggle.addEventListener("change", (e) => {
  state.grouped = e.target.checked;
  renderFilters();
  renderGlobalGrid();
});

els.sortSelect.addEventListener("change", (e) => {
  state.sort = e.target.value;
  renderGlobalGrid();
});

els.resetFiltersBtn.addEventListener("click", () => {
  state.category = "All";
  state.search = "";
  els.searchInput.value = "";
  els.kbdHint.classList.remove("hidden");
  renderFilters();
  renderGlobalGrid();
});

els.recheckLiveBtn.addEventListener("click", async () => {
  els.recheckLiveBtn.disabled = true;
  els.recheckLiveBtn.textContent = "Checking...";
  await syncLiveBadges();
  els.recheckLiveBtn.disabled = false;
  els.recheckLiveBtn.textContent = "Check live now";
  showToast("Checked live Twitch badges");
});

els.channelForm.addEventListener("submit", (e) => {
  e.preventDefault();
  lookupChannel(els.channelInput.value);
});

for (const chip of document.querySelectorAll(".quick-chip")) {
  chip.addEventListener("click", () => lookupChannel(chip.dataset.channel));
}

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
    document.activeElement !== els.searchInput &&
    document.activeElement?.tagName !== "INPUT"
  ) {
    e.preventDefault();
    els.searchInput.focus();
  }
});

init();
