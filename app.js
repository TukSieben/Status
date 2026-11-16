const GQL_URL = "https://gql.twitch.tv/gql";
const TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const PAGE_SIZE = 48;
const STORAGE_USER_KEY = "badgestatus_last_user";

const ALWAYS_AVAILABLE_IDS = new Set([
  "anonymous-cheerer",
  "bits",
  "bits-leader",
  "clips-leader",
  "founder",
  "hype-train",
  "mod-founder",
  "no_audio",
  "no_video",
  "predictions",
  "premium",
  "social-sharing",
  "sub-gift-leader",
  "sub-gifter",
  "subscriber",
  "turbo",
]);

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

const state = {
  view: "available",
  layout: "list",
  badges: [],
  syncedAt: null,
  availFilter: "all",
  ownership: "missing",
  availability: "any",
  cost: "any",
  sort: "obtainable",
  search: "",
  grouped: true,
  page: 1,
  showAll: false,
  checkedUser: null,
  ownedKeys: new Set(),
  ownedSetIDs: new Set(),
  ownedUuids: new Set(),
  activeModalBadge: null,
  activeModalSiblings: [],
  toastTimer: null,
};

const els = {
  navTabs: document.querySelectorAll(".nav-tab"),
  views: {
    available: document.getElementById("view-available"),
    missing: document.getElementById("view-missing"),
  },
  activeCountPill: document.getElementById("activeCountPill"),
  missingCountPill: document.getElementById("missingCountPill"),
  userForm: document.getElementById("userForm"),
  userInput: document.getElementById("userInput"),
  clearUserBtn: document.getElementById("clearUserBtn"),
  checkUserBtn: document.getElementById("checkUserBtn"),
  userBanner: document.getElementById("userBanner"),
  userError: document.getElementById("userError"),
  availableFilterGroup: document.getElementById("availableFilterGroup"),
  availMissingChip: document.getElementById("availMissingChip"),
  availablePrompt: document.getElementById("availablePrompt"),
  activeHeadingCount: document.getElementById("activeHeadingCount"),
  activeDropsContainer: document.getElementById("activeDropsContainer"),
  activeDropsEmpty: document.getElementById("activeDropsEmpty"),
  upcomingBlock: document.getElementById("upcomingBlock"),
  upcomingHeadingCount: document.getElementById("upcomingHeadingCount"),
  upcomingDropsContainer: document.getElementById("upcomingDropsContainer"),
  alwaysHeadingCount: document.getElementById("alwaysHeadingCount"),
  alwaysDropsContainer: document.getElementById("alwaysDropsContainer"),
  missingProgressPanel: document.getElementById("missingProgressPanel"),
  progressHeadline: document.getElementById("progressHeadline"),
  progressSub: document.getElementById("progressSub"),
  progressPct: document.getElementById("progressPct"),
  progressFill: document.getElementById("progressFill"),
  progressChips: document.getElementById("progressChips"),
  missingPrompt: document.getElementById("missingPrompt"),
  ownershipSelect: document.getElementById("ownershipSelect"),
  availabilitySelect: document.getElementById("availabilitySelect"),
  missingCostSelect: document.getElementById("missingCostSelect"),
  missingSortSelect: document.getElementById("missingSortSelect"),
  missingSearchInput: document.getElementById("missingSearchInput"),
  kbdHint: document.getElementById("kbdHint"),
  groupToggle: document.getElementById("groupToggle"),
  missingResultsMeta: document.getElementById("missingResultsMeta"),
  missingTopPag: document.getElementById("missingTopPag"),
  missingBottomPag: document.getElementById("missingBottomPag"),
  missingCollection: document.getElementById("missingCollection"),
  missingEmpty: document.getElementById("missingEmpty"),
  resetMissingBtn: document.getElementById("resetMissingBtn"),
  footerSync: document.getElementById("footerSync"),
  layoutBtns: document.querySelectorAll(".layout-btn"),
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
  modalAvail: document.getElementById("modalAvail"),
  modalUsers: document.getElementById("modalUsers"),
  modalSetId: document.getElementById("modalSetId"),
  modalVersion: document.getElementById("modalVersion"),
  copySetIdBtn: document.getElementById("copySetIdBtn"),
  copyVersionBtn: document.getElementById("copyVersionBtn"),
  chatThemeToggle: document.getElementById("chatThemeToggle"),
  chatBox: document.getElementById("chatBox"),
  chatBadgeImg: document.getElementById("chatBadgeImg"),
  chatUserName: document.getElementById("chatUserName"),
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

function extractUuid(url) {
  const m = (url || "").match(/\/v1\/([a-f0-9-]{36})\//i);
  return m ? m[1].toLowerCase() : "";
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

function getAvailability(badge, nowMs = Date.now()) {
  if (badge.endAt) {
    const endMs = Date.parse(badge.endAt);
    const startMs = badge.startAt ? Date.parse(badge.startAt) : 0;
    if (!Number.isNaN(endMs) && endMs > nowMs) {
      if (!Number.isNaN(startMs) && startMs > nowMs) {
        return {
          status: "upcoming",
          label: "Upcoming",
          targetMs: startMs,
          prefix: "Starts in ",
        };
      }
      return {
        status: "active",
        label: "Active Now",
        targetMs: endMs,
        prefix: "Ends in ",
      };
    }
    return { status: "ended", label: "Ended", targetMs: null, prefix: "" };
  }

  if (badge.alwaysAvailable || ALWAYS_AVAILABLE_IDS.has((badge.setID || "").toLowerCase())) {
    return {
      status: "always",
      label: "Always Available",
      targetMs: null,
      prefix: "",
    };
  }

  return { status: "ended", label: "Ended", targetMs: null, prefix: "" };
}

function formatCountdown(targetMs, prefix) {
  const diff = targetMs - Date.now();
  if (diff <= 0) return prefix.includes("Starts") ? "Live now" : "Ended";
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff / 3_600_000) % 24);
  const mins = Math.floor((diff / 60_000) % 60);
  const secs = Math.floor((diff / 1_000) % 60);
  const pad = (n) => String(n).padStart(2, "0");
  if (days > 0) return `${prefix}${days}d ${pad(hours)}h ${pad(mins)}m`;
  return `${prefix}${pad(hours)}h ${pad(mins)}m ${pad(secs)}s`;
}

function updateCountdowns() {
  for (const el of document.querySelectorAll("[data-countdown-target]")) {
    const target = Number(el.dataset.countdownTarget);
    const prefix = el.dataset.countdownPrefix || "";
    el.textContent = formatCountdown(target, prefix);
  }
}

function isBadgeOwned(badge, useSetFallback = false) {
  if (!state.checkedUser) return false;
  if (state.ownedKeys.has(badgeKey(badge))) return true;
  const uuid = extractUuid(badge.image4x || badge.image2x || badge.image1x);
  if (uuid && state.ownedUuids.has(uuid)) return true;
  if (useSetFallback && state.ownedSetIDs.has(badge.setID)) return true;
  return false;
}

function formatUsersShort(badge) {
  if (typeof badge.userCount !== "number") return "Users: N/A";
  const count = badge.userCount.toLocaleString("en-US");
  if (typeof badge.percentage === "number" && badge.percentage >= 0.01) {
    return `${count} (${badge.percentage.toFixed(2)}%)`;
  }
  return `${count} owners`;
}

function getUnlockText(badge) {
  return (
    (badge.objective && badge.objective.trim()) ||
    (badge.description && badge.description.trim()) ||
    "No unlock instructions provided by Twitch."
  );
}

function classifyFallbackCost(raw) {
  const sid = (raw.setID || "").toLowerCase();
  const desc = (raw.description || "").toLowerCase();
  if (ROLE_SET_IDS.has(sid) || desc.includes("twitch staff")) return "role";
  if (PAID_PLATFORM_IDS.has(sid) || PAID_RE.test(desc)) return "paid";
  return "free";
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

function createPill(text, cls) {
  const el = document.createElement("span");
  el.className = `pill ${cls}`;
  el.textContent = text;
  return el;
}

function renderCard(badge, siblings = [badge], tierCount = 1, useSetFallback = false) {
  const owned = isBadgeOwned(badge, useSetFallback);
  const avail = getAvailability(badge);

  if (state.layout === "grid") {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `badge-grid-card${owned ? " is-owned" : ""}`;
    card.addEventListener("click", () => openBadgeModal(badge, siblings, useSetFallback));

    const topPills = document.createElement("div");
    topPills.className = "grid-top-pills";

    if (state.checkedUser) {
      topPills.appendChild(createPill(owned ? "Owned" : "Missing", owned ? "is-owned" : "is-missing"));
    } else if (avail.status === "active") {
      topPills.appendChild(createPill("Active", "is-active-drop"));
    } else if (avail.status === "upcoming") {
      topPills.appendChild(createPill("Upcoming", "is-upcoming"));
    } else if (avail.status === "always") {
      topPills.appendChild(createPill("Always", "is-always"));
    } else {
      topPills.appendChild(createPill("Ended", "is-ended"));
    }

    const costCls =
      badge.cost === "paid" ? "is-paid" : badge.cost === "role" ? "is-role" : "is-free";
    const costLabel =
      badge.cost === "paid" ? "Paid" : badge.cost === "role" ? "Role" : "Free";
    topPills.appendChild(createPill(costLabel, costCls));

    const img = document.createElement("img");
    img.className = "grid-icon";
    img.src = badge.image4x || badge.image2x || badge.image1x;
    img.alt = badge.title;
    img.loading = "lazy";
    img.decoding = "async";

    const title = document.createElement("div");
    title.className = "grid-title";
    title.textContent = badge.title;

    const desc = document.createElement("div");
    desc.className = "grid-desc";
    desc.textContent = getUnlockText(badge);

    const bottom = document.createElement("div");
    bottom.className = "grid-bottom";

    if (avail.targetMs) {
      const cd = document.createElement("span");
      cd.dataset.countdownTarget = String(avail.targetMs);
      cd.dataset.countdownPrefix = avail.prefix;
      cd.textContent = formatCountdown(avail.targetMs, avail.prefix);
      bottom.appendChild(cd);
    } else {
      const u = document.createElement("span");
      u.textContent = typeof badge.userCount === "number" ? badge.userCount.toLocaleString("en-US") : badge.setID;
      bottom.appendChild(u);
    }

    const rightSpan = document.createElement("span");
    rightSpan.textContent = tierCount > 1 ? `${tierCount} tiers` : avail.label;
    bottom.appendChild(rightSpan);

    card.append(topPills, img, title, desc, bottom);
    return card;
  }

  // List Card
  const card = document.createElement("button");
  card.type = "button";
  card.className = `badge-row-card${owned ? " is-owned" : ""}`;
  card.addEventListener("click", () => openBadgeModal(badge, siblings, useSetFallback));

  const meta = document.createElement("div");
  meta.className = "row-meta";

  if (state.checkedUser) {
    meta.appendChild(createPill(owned ? "Owned" : "Missing", owned ? "is-owned" : "is-missing"));
  }

  const availCls =
    avail.status === "active"
      ? "is-active-drop"
      : avail.status === "upcoming"
        ? "is-upcoming"
        : avail.status === "always"
          ? "is-always"
          : "is-ended";
  meta.appendChild(createPill(avail.label, availCls));

  const costCls =
    badge.cost === "paid" ? "is-paid" : badge.cost === "role" ? "is-role" : "is-free";
  const costLabel =
    badge.cost === "paid" ? "Paid" : badge.cost === "role" ? "Role" : "Free";
  meta.appendChild(createPill(costLabel, costCls));

  if (typeof badge.userCount === "number") {
    const u = document.createElement("span");
    u.className = "meta-text";
    u.textContent = formatUsersShort(badge);
    meta.appendChild(u);
  }

  if (tierCount > 1) {
    const t = document.createElement("span");
    t.className = "meta-text";
    t.textContent = `${tierCount} tiers`;
    meta.appendChild(t);
  }

  if (avail.targetMs) {
    const cd = document.createElement("span");
    cd.className = "meta-countdown";
    cd.dataset.countdownTarget = String(avail.targetMs);
    cd.dataset.countdownPrefix = avail.prefix;
    cd.textContent = formatCountdown(avail.targetMs, avail.prefix);
    meta.appendChild(cd);
  }

  const main = document.createElement("div");
  main.className = "row-main";

  const img = document.createElement("img");
  img.className = "row-icon";
  img.src = badge.image4x || badge.image2x || badge.image1x;
  img.alt = badge.title;
  img.loading = "lazy";
  img.decoding = "async";

  const textCol = document.createElement("div");
  textCol.className = "row-text";

  const titleWrap = document.createElement("div");
  titleWrap.className = "row-title-wrap";
  const titleEl = document.createElement("span");
  titleEl.className = "row-title";
  titleEl.textContent = badge.title;
  const setEl = document.createElement("span");
  setEl.className = "row-set";
  setEl.textContent = badge.setID;
  titleWrap.append(titleEl, setEl);

  const descEl = document.createElement("p");
  descEl.className = "row-desc";
  descEl.textContent = getUnlockText(badge);

  textCol.append(titleWrap, descEl);
  main.append(img, textCol);
  card.append(meta, main);
  return card;
}

function renderAvailableView() {
  const nowMs = Date.now();
  const active = [];
  const upcoming = [];
  const alwaysMap = new Map();

  for (const b of state.badges) {
    const avail = getAvailability(b, nowMs);
    if (avail.status === "active") active.push(b);
    else if (avail.status === "upcoming") upcoming.push(b);
    else if (avail.status === "always" && !alwaysMap.has(b.setID)) {
      alwaysMap.set(b.setID, b);
    }
  }

  els.activeCountPill.textContent = String(active.length);

  const applyAvailFilter = (list) =>
    list.filter((b) => {
      if (state.availFilter === "missing" && state.checkedUser && isBadgeOwned(b)) {
        return false;
      }
      if (state.availFilter === "free" && b.cost !== "free") return false;
      if (state.availFilter === "paid" && b.cost !== "paid") return false;
      return true;
    });

  const filteredActive = applyAvailFilter(active).sort((a, b) => {
    if (state.checkedUser) {
      const oa = isBadgeOwned(a);
      const ob = isBadgeOwned(b);
      if (oa !== ob) return oa ? 1 : -1;
    }
    if ((a.cost === "free") !== (b.cost === "free")) {
      return a.cost === "free" ? -1 : 1;
    }
    return Date.parse(a.endAt) - Date.parse(b.endAt);
  });

  const filteredUpcoming = applyAvailFilter(upcoming).sort(
    (a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)
  );

  els.activeHeadingCount.textContent = `(${filteredActive.length})`;
  els.activeDropsContainer.replaceChildren();
  els.activeDropsContainer.className =
    state.layout === "grid" ? "badge-grid-view" : "badge-list";

  if (!filteredActive.length) {
    els.activeDropsEmpty.classList.remove("hidden");
  } else {
    els.activeDropsEmpty.classList.add("hidden");
    const frag = document.createDocumentFragment();
    for (const b of filteredActive) {
      frag.appendChild(renderCard(b, [b], 1, false));
    }
    els.activeDropsContainer.appendChild(frag);
  }

  if (filteredUpcoming.length) {
    els.upcomingBlock.classList.remove("hidden");
    els.upcomingHeadingCount.textContent = `(${filteredUpcoming.length})`;
    els.upcomingDropsContainer.replaceChildren();
    els.upcomingDropsContainer.className =
      state.layout === "grid" ? "badge-grid-view" : "badge-list";
    const uFrag = document.createDocumentFragment();
    for (const b of filteredUpcoming) {
      uFrag.appendChild(renderCard(b, [b], 1, false));
    }
    els.upcomingDropsContainer.appendChild(uFrag);
  } else {
    els.upcomingBlock.classList.add("hidden");
  }

  // Always available platform badges (grouped by setID)
  const alwaysList = Array.from(alwaysMap.values()).sort((a, b) => {
    if (state.checkedUser) {
      const oa = isBadgeOwned(a, true);
      const ob = isBadgeOwned(b, true);
      if (oa !== ob) return oa ? 1 : -1;
    }
    return a.title.localeCompare(b.title);
  });
  els.alwaysHeadingCount.textContent = `(${alwaysList.length} sets)`;
  els.alwaysDropsContainer.replaceChildren();
  els.alwaysDropsContainer.className =
    state.layout === "grid" ? "badge-grid-view always-body" : "badge-list always-body";
  const aFrag = document.createDocumentFragment();
  for (const b of alwaysList) {
    const siblings = state.badges.filter((x) => x.setID === b.setID).sort(compareVersions);
    aFrag.appendChild(renderCard(b, siblings, siblings.length, true));
  }
  els.alwaysDropsContainer.appendChild(aFrag);
}

function getMissingCatalogItems() {
  const q = state.search.trim().toLowerCase();
  const matchesQ = (b) =>
    !q ||
    b.title.toLowerCase().includes(q) ||
    b.setID.toLowerCase().includes(q) ||
    (b.description || "").toLowerCase().includes(q) ||
    (b.objective || "").toLowerCase().includes(q);

  if (!state.grouped) {
    return state.badges.filter(matchesQ).map((b) => ({
      badge: b,
      siblings: state.badges.filter((x) => x.setID === b.setID).sort(compareVersions),
      tierCount: 1,
      useSetFallback: false,
    }));
  }

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

    items.push({
      badge: rep,
      siblings: versions,
      tierCount: versions.length,
      useSetFallback: versions.length > 1,
    });
  }
  return items;
}

function renderPagination(container, total, totalPages) {
  container.replaceChildren();
  if (!total) return;

  const left = document.createElement("div");
  left.className = "pagination-bar";

  if (!state.showAll && totalPages > 1) {
    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "pag-btn";
    prev.textContent = "←";
    prev.disabled = state.page <= 1;
    prev.addEventListener("click", () => {
      state.page -= 1;
      renderMissingView();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    const lbl = document.createElement("span");
    lbl.className = "mono-count";
    lbl.textContent = `Page ${state.page} / ${totalPages}`;

    const next = document.createElement("button");
    next.type = "button";
    next.className = "pag-btn";
    next.textContent = "→";
    next.disabled = state.page >= totalPages;
    next.addEventListener("click", () => {
      state.page += 1;
      renderMissingView();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    left.append(prev, lbl, next);
  }

  const toggleAll = document.createElement("button");
  toggleAll.type = "button";
  toggleAll.className = "pag-btn";
  toggleAll.textContent = state.showAll ? "Paginate (48)" : `Show All (${total})`;
  toggleAll.addEventListener("click", () => {
    state.showAll = !state.showAll;
    state.page = 1;
    renderMissingView();
  });

  container.append(left, toggleAll);
}

function renderMissingView() {
  const allSets = getMissingCatalogItems();

  // Compute user collection stats across unique global sets
  const bySetAll = new Map();
  for (const b of state.badges) {
    if (!bySetAll.has(b.setID)) bySetAll.set(b.setID, b);
  }
  const uniqueBadges = Array.from(bySetAll.values());

  if (state.checkedUser) {
    els.missingPrompt.classList.add("hidden");
    els.missingProgressPanel.classList.remove("hidden");

    const ownedCount = uniqueBadges.filter((b) => isBadgeOwned(b, true)).length;
    const missingBadges = uniqueBadges.filter((b) => !isBadgeOwned(b, true));
    const missingCount = missingBadges.length;
    const pct = uniqueBadges.length ? ((ownedCount / uniqueBadges.length) * 100).toFixed(1) : "0.0";

    els.missingCountPill.textContent = String(missingCount);
    els.progressHeadline.textContent = `${ownedCount} Owned · ${missingCount} Missing`;
    els.progressSub.textContent = `out of ${uniqueBadges.length} global badge sets`;
    els.progressPct.textContent = `${pct}%`;
    els.progressFill.style.width = `${pct}%`;

    const missingActive = missingBadges.filter((b) => getAvailability(b).status === "active").length;
    const missingAlways = missingBadges.filter((b) => getAvailability(b).status === "always").length;
    const missingEnded = missingBadges.filter((b) => getAvailability(b).status === "ended").length;

    els.progressChips.replaceChildren();
    const chipSpecs = [
      [`Missing Active Drops: ${missingActive}`, () => {
        state.ownership = "missing";
        state.availability = "active";
        els.ownershipSelect.value = "missing";
        els.availabilitySelect.value = "active";
        state.page = 1;
        renderMissingView();
      }],
      [`Missing Always Available: ${missingAlways}`, () => {
        state.ownership = "missing";
        state.availability = "always";
        els.ownershipSelect.value = "missing";
        els.availabilitySelect.value = "always";
        state.page = 1;
        renderMissingView();
      }],
      [`Missing Ended / Legacy: ${missingEnded}`, () => {
        state.ownership = "missing";
        state.availability = "ended";
        els.ownershipSelect.value = "missing";
        els.availabilitySelect.value = "ended";
        state.page = 1;
        renderMissingView();
      }],
    ];
    for (const [text, handler] of chipSpecs) {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "prog-chip";
      c.textContent = text;
      c.addEventListener("click", handler);
      els.progressChips.appendChild(c);
    }
  } else {
    els.missingProgressPanel.classList.add("hidden");
    els.missingPrompt.classList.remove("hidden");
    els.missingCountPill.textContent = String(uniqueBadges.length);
  }

  const nowMs = Date.now();
  const filtered = allSets.filter((item) => {
    const b = item.badge;
    const owned = isBadgeOwned(b, item.useSetFallback);
    if (state.checkedUser) {
      if (state.ownership === "missing" && owned) return false;
      if (state.ownership === "owned" && !owned) return false;
    }
    if (state.cost !== "any" && b.cost !== state.cost) return false;

    const status = getAvailability(b, nowMs).status;
    if (state.availability === "obtainable" && status !== "active" && status !== "always") {
      return false;
    }
    if (state.availability === "active" && status !== "active") return false;
    if (state.availability === "upcoming" && status !== "upcoming") return false;
    if (state.availability === "always" && status !== "always") return false;
    if (state.availability === "ended" && status !== "ended") return false;
    return true;
  });

  const availRank = { active: 0, upcoming: 1, always: 2, ended: 3 };
  filtered.sort((a, b) => {
    const ba = a.badge;
    const bb = b.badge;
    if (state.sort === "obtainable") {
      const ra = availRank[getAvailability(ba, nowMs).status];
      const rb = availRank[getAvailability(bb, nowMs).status];
      if (ra !== rb) return ra - rb;
      return (bb.userCount || 0) - (ba.userCount || 0) || ba.title.localeCompare(bb.title);
    }
    if (state.sort === "users_desc") {
      return (bb.userCount ?? -1) - (ba.userCount ?? -1) || ba.title.localeCompare(bb.title);
    }
    if (state.sort === "users_asc") {
      const ua = typeof ba.userCount === "number" ? ba.userCount : 1e12;
      const ub = typeof bb.userCount === "number" ? bb.userCount : 1e12;
      return ua - ub || ba.title.localeCompare(bb.title);
    }
    return ba.title.localeCompare(bb.title);
  });

  els.missingResultsMeta.textContent = `${filtered.length} ${state.grouped ? "sets" : "badges"}`;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;

  const visible = state.showAll
    ? filtered
    : filtered.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

  renderPagination(els.missingTopPag, filtered.length, totalPages);
  renderPagination(els.missingBottomPag, filtered.length, totalPages);

  els.missingCollection.replaceChildren();
  els.missingCollection.className =
    state.layout === "grid" ? "badge-grid-view" : "badge-list";

  if (!filtered.length) {
    els.missingEmpty.classList.remove("hidden");
    return;
  }
  els.missingEmpty.classList.add("hidden");

  const frag = document.createDocumentFragment();
  for (const item of visible) {
    frag.appendChild(
      renderCard(item.badge, item.siblings, item.tierCount, item.useSetFallback)
    );
  }
  els.missingCollection.appendChild(frag);
}

function renderUserBanner() {
  if (!state.checkedUser) {
    els.userBanner.classList.add("hidden");
    els.availablePrompt.classList.remove("hidden");
    els.availMissingChip.classList.add("hidden");
    if (state.availFilter === "missing") state.availFilter = "all";
    els.clearUserBtn.classList.add("hidden");
    els.ownershipSelect.value = "all";
    els.ownershipSelect.disabled = true;
    return;
  }

  els.ownershipSelect.disabled = false;
  els.ownershipSelect.value = state.ownership;
  els.availablePrompt.classList.add("hidden");
  els.availMissingChip.classList.remove("hidden");
  els.clearUserBtn.classList.remove("hidden");
  els.userBanner.classList.remove("hidden");

  const activeNow = state.badges.filter((b) => getAvailability(b).status === "active");
  const missingActiveCount = activeNow.filter((b) => !isBadgeOwned(b)).length;
  const ownedActiveCount = activeNow.length - missingActiveCount;

  els.userBanner.replaceChildren();

  const left = document.createElement("div");
  left.className = "user-banner-left";

  if (state.checkedUser.profileImageURL) {
    const av = document.createElement("img");
    av.className = "user-avatar";
    av.src = state.checkedUser.profileImageURL;
    av.alt = state.checkedUser.displayName || state.checkedUser.login;
    left.appendChild(av);
  }

  const info = document.createElement("div");
  const nameLine = document.createElement("div");
  nameLine.className = "user-name-title";
  nameLine.textContent = `@${state.checkedUser.displayName || state.checkedUser.login}`;
  const statsLine = document.createElement("div");
  statsLine.className = "user-stats-line";
  statsLine.textContent = `${missingActiveCount} of ${activeNow.length} active drops missing · ${ownedActiveCount} owned`;
  info.append(nameLine, statsLine);
  left.appendChild(info);

  const right = document.createElement("div");
  right.className = "user-banner-pills";
  right.appendChild(
    createPill(`${missingActiveCount} Active Missing`, missingActiveCount > 0 ? "is-missing" : "is-owned")
  );
  right.appendChild(createPill(`${state.ownedSetIDs.size} Global Earned`, "is-owned"));

  els.userBanner.append(left, right);
}

async function checkTwitchUser(rawName, updateUrl = true) {
  const login = rawName.trim().toLowerCase().replace(/^@/, "");
  if (!login) return;

  els.userInput.value = login;
  els.checkUserBtn.disabled = true;
  els.checkUserBtn.textContent = "...";
  els.userError.classList.add("hidden");

  try {
    const data = await gqlRequest(
      `query CheckUserBadges($login: String!) {
        user(login: $login) {
          id
          login
          displayName
          profileImageURL(width: 70)
          chatColor
        }
        channelViewer(channelLogin: $login, userLogin: $login) {
          earnedBadges {
            setID
            version
            title
            imageURL(size: QUADRUPLE)
          }
        }
      }`,
      { login }
    );

    const user = data?.user;
    if (!user?.id) {
      throw new Error(`Twitch user "${login}" was not found.`);
    }

    const wasEmpty = !state.checkedUser;
    const earned = data?.channelViewer?.earnedBadges || [];
    state.checkedUser = user;
    if (wasEmpty) state.ownership = "missing";
    state.ownedKeys = new Set();
    state.ownedSetIDs = new Set();
    state.ownedUuids = new Set();

    for (const eb of earned) {
      if (eb.setID) {
        state.ownedSetIDs.add(eb.setID);
        state.ownedKeys.add(`${eb.setID}::${eb.version || "1"}`);
      }
      const uuid = extractUuid(eb.imageURL);
      if (uuid) state.ownedUuids.add(uuid);
    }

    try {
      localStorage.setItem(STORAGE_USER_KEY, user.login);
    } catch {}

    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set("user", user.login);
      history.replaceState(null, "", url.toString());
    }

    renderUserBanner();
    renderAvailableView();
    renderMissingView();
  } catch (err) {
    els.userError.textContent = err?.message || "Failed to look up Twitch user.";
    els.userError.classList.remove("hidden");
  } finally {
    els.checkUserBtn.disabled = false;
    els.checkUserBtn.textContent = "Check";
  }
}

function clearCheckedUser() {
  state.checkedUser = null;
  state.ownedKeys = new Set();
  state.ownedSetIDs = new Set();
  state.ownedUuids = new Set();
  els.userInput.value = "";
  els.userError.classList.add("hidden");

  try {
    localStorage.removeItem(STORAGE_USER_KEY);
  } catch {}

  const url = new URL(window.location.href);
  url.searchParams.delete("user");
  history.replaceState(null, "", url.toString());

  for (const c of els.availableFilterGroup.querySelectorAll(".filter-chip")) {
    c.classList.toggle("is-active", c.dataset.availFilter === "all");
  }
  state.availFilter = "all";

  renderUserBanner();
  renderAvailableView();
  renderMissingView();
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

  const url = new URL(window.location.href);
  url.hash = `#${viewName}`;
  history.replaceState(null, "", url.toString());
}

function openBadgeModal(badge, siblings = [badge], useSetFallback = false) {
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

  els.chatUserName.textContent = state.checkedUser?.displayName || "badgestatus";

  const avail = getAvailability(badge);
  const owned = isBadgeOwned(badge, useSetFallback);

  els.modalTags.replaceChildren();
  if (state.checkedUser) {
    els.modalTags.appendChild(createPill(owned ? "Owned" : "Missing", owned ? "is-owned" : "is-missing"));
  }
  const costCls = badge.cost === "paid" ? "is-paid" : badge.cost === "role" ? "is-role" : "is-free";
  const costLbl = badge.cost === "paid" ? "Paid" : badge.cost === "role" ? "Role" : "Free";
  els.modalTags.appendChild(createPill(costLbl, costCls));

  const availCls =
    avail.status === "active"
      ? "is-active-drop"
      : avail.status === "upcoming"
        ? "is-upcoming"
        : avail.status === "always"
          ? "is-always"
          : "is-ended";
  els.modalTags.appendChild(createPill(avail.label, availCls));

  els.modalTitle.textContent = badge.title;
  els.modalDesc.textContent = getUnlockText(badge);

  els.modalAvail.textContent = avail.targetMs
    ? formatCountdown(avail.targetMs, avail.prefix)
    : avail.label;
  els.modalUsers.textContent =
    typeof badge.userCount === "number" ? formatUsersShort(badge) : "N/A";
  els.modalSetId.textContent = badge.setID;
  els.modalVersion.textContent = String(badge.version);

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
        openBadgeModal(ver, state.activeModalSiblings, false)
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

async function syncLiveGlobalBadges() {
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

    const byKey = new Map(state.badges.map((b) => [badgeKey(b), b]));
    const merged = [];
    let addedLive = 0;

    for (const item of raw) {
      const k = badgeKey(item);
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
        addedLive += 1;
        merged.push({
          setID: item.setID,
          version: String(item.version),
          title: (item.title || item.setID).trim(),
          description: (item.description || "").trim(),
          cost: classifyFallbackCost(item),
          alwaysAvailable: ALWAYS_AVAILABLE_IDS.has((item.setID || "").toLowerCase()),
          userCount: null,
          percentage: null,
          startAt: null,
          endAt: null,
          objective: null,
          image1x: item.image1x,
          image2x: item.image2x,
          image4x: item.image4x,
          clickAction: item.clickAction,
          clickURL: item.clickURL,
        });
      }
    }

    if (addedLive > 0) {
      state.badges = merged;
      renderUserBanner();
      renderAvailableView();
      renderMissingView();
    }
    els.footerSync.textContent = `Live Twitch sync · ${state.badges.length} badges`;
  } catch {
    // Keep snapshot data silently
  }
}

async function init() {
  const hash = window.location.hash.replace("#", "");
  if (els.views[hash]) setView(hash);

  try {
    const res = await fetch("./data/badges.json");
    if (res.ok) {
      const doc = await res.json();
      state.badges = doc.badges || [];
      state.syncedAt = doc.syncedAt || null;
      els.footerSync.textContent = `${state.badges.length} global badges tracked`;
    }
  } catch {
    els.footerSync.textContent = "Loading live data...";
  }

  renderUserBanner();
  renderAvailableView();
  renderMissingView();

  // Restore ?user= param or saved username
  const urlUser = new URLSearchParams(window.location.search).get("user");
  let savedUser = "";
  try {
    savedUser = localStorage.getItem(STORAGE_USER_KEY) || "";
  } catch {}
  const initialUser = urlUser || savedUser;
  if (initialUser) {
    await checkTwitchUser(initialUser, Boolean(urlUser));
  }

  syncLiveGlobalBadges();
  setInterval(updateCountdowns, 1000);
}

// Event Listeners
for (const tab of els.navTabs) {
  tab.addEventListener("click", () => setView(tab.dataset.view));
}

document.getElementById("brandLink").addEventListener("click", (e) => {
  e.preventDefault();
  setView("available");
});

els.userForm.addEventListener("submit", (e) => {
  e.preventDefault();
  checkTwitchUser(els.userInput.value);
});

els.clearUserBtn.addEventListener("click", clearCheckedUser);

for (const btn of document.querySelectorAll("[data-quick-user]")) {
  btn.addEventListener("click", () => checkTwitchUser(btn.dataset.quickUser));
}

for (const chip of els.availableFilterGroup.querySelectorAll(".filter-chip")) {
  chip.addEventListener("click", () => {
    state.availFilter = chip.dataset.availFilter;
    for (const c of els.availableFilterGroup.querySelectorAll(".filter-chip")) {
      c.classList.toggle("is-active", c === chip);
    }
    renderAvailableView();
  });
}

for (const btn of els.layoutBtns) {
  btn.addEventListener("click", () => {
    state.layout = btn.dataset.layout;
    for (const b of els.layoutBtns) {
      b.classList.toggle("is-active", b.dataset.layout === state.layout);
    }
    renderAvailableView();
    renderMissingView();
  });
}

els.ownershipSelect.addEventListener("change", (e) => {
  state.ownership = e.target.value;
  state.page = 1;
  renderMissingView();
});

els.availabilitySelect.addEventListener("change", (e) => {
  state.availability = e.target.value;
  state.page = 1;
  renderMissingView();
});

els.missingCostSelect.addEventListener("change", (e) => {
  state.cost = e.target.value;
  state.page = 1;
  renderMissingView();
});

els.missingSortSelect.addEventListener("change", (e) => {
  state.sort = e.target.value;
  state.page = 1;
  renderMissingView();
});

els.missingSearchInput.addEventListener("input", (e) => {
  state.search = e.target.value;
  state.page = 1;
  els.kbdHint.classList.toggle("hidden", state.search.length > 0);
  renderMissingView();
});

els.groupToggle.addEventListener("change", (e) => {
  state.grouped = e.target.checked;
  state.page = 1;
  renderMissingView();
});

els.resetMissingBtn.addEventListener("click", () => {
  state.ownership = state.checkedUser ? "missing" : "all";
  state.availability = "any";
  state.cost = "any";
  state.search = "";
  state.page = 1;
  els.ownershipSelect.value = state.ownership;
  els.availabilitySelect.value = "any";
  els.missingCostSelect.value = "any";
  els.missingSearchInput.value = "";
  els.kbdHint.classList.remove("hidden");
  renderMissingView();
});

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
    state.view === "missing" &&
    els.badgeModal.classList.contains("hidden") &&
    document.activeElement?.tagName !== "INPUT"
  ) {
    e.preventDefault();
    els.missingSearchInput.focus();
  }
});

init();
