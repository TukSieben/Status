// Shared helpers used by every BadgeStatus page.

export const GQL_URL = "https://gql.twitch.tv/gql";
export const TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
export const URGENT_MS = 48 * 60 * 60 * 1000;
export const DATA_URL = "/data/badges.json";

/* ---------- DOM ---------- */

export const $ = (id) => document.getElementById(id);

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function showToast(msg) {
  const toast = $("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 1800);
}

/* ---------- Badges ---------- */

/** Badge image URL. size: 1, 2 or 4 (default). */
export function img(badge, size = 4) {
  if (size === 1) return badge.image1x || badge.image2x || badge.image4x || "";
  if (size === 2) return badge.image2x || badge.image4x || badge.image1x || "";
  return badge.image4x || badge.image2x || badge.image1x || "";
}

/** Falls back from the 4x to the 2x/1x CDN image if one fails to load. */
export function onImgError(e) {
  const node = e.currentTarget;
  const src = node.src;
  if (src.endsWith("/3")) node.src = src.slice(0, -2) + "/2";
  else if (src.endsWith("/2")) node.src = src.slice(0, -2) + "/1";
}

export function badgeImg(badge, className = "", size = 4) {
  const image = el("img", className);
  image.src = img(badge, size);
  image.alt = badge.title;
  image.loading = "lazy";
  image.addEventListener("error", onImgError);
  return image;
}

export function badgeHref(badge) {
  return `/badge/?id=${encodeURIComponent(badge.setID)}`;
}

export function extractUuid(url) {
  const m = (url || "").match(/\/v1\/([a-f0-9-]{36})\//i);
  return m ? m[1].toLowerCase() : "";
}

/** "active" | "upcoming" | "ended" based on the badge's schedule. */
export function statusOf(badge, now = Date.now()) {
  const end = Date.parse(badge.endAt || "");
  if (Number.isNaN(end) || end <= now) return "ended";
  const start = Date.parse(badge.startAt || "");
  if (!Number.isNaN(start) && start > now) return "upcoming";
  return "active";
}

/** Splits badges into currently active and upcoming (deduplicated by set). */
export function splitBadges(badges, now = Date.now()) {
  const active = [];
  const upcoming = [];
  const seen = new Set();
  for (const b of badges) {
    if (seen.has(b.setID)) continue;
    const s = statusOf(b, now);
    if (s === "ended") continue;
    seen.add(b.setID);
    (s === "active" ? active : upcoming).push(b);
  }
  upcoming.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  return { active, upcoming };
}

export function objectiveText(badge) {
  return badge.objective?.trim() || badge.description?.trim() || "Unlock details not announced yet.";
}

export function pill(text, kind, upper = false) {
  return el("span", `pill pill-${kind}${upper ? " pill-upper" : ""}`, text);
}

/** Free badge: no sub, gift or bits needed (what a non-affiliate channel can offer) */
export function isFreeBadge(badge) {
  return badge.cost !== "paid" && !/subscri|gift|cheer|\bbits\b/i.test(badge.objective || "");
}

/** Pages with ?free=1 show only free badges */
export const FREE_ONLY = new URLSearchParams(location.search).get("free") === "1";
export const onlyFree = (list) => (FREE_ONLY ? list.filter(isFreeBadge) : list);

export function costPill(badge) {
  return badge.cost === "paid" ? pill("Paid", "paid") : pill("Free", "free");
}

/* ---------- Time & numbers ---------- */

export function countdown(targetMs) {
  const diff = targetMs - Date.now();
  if (diff <= 0) return "0h 00m 00s";
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff / 3_600_000) % 24);
  const m = Math.floor((diff / 60_000) % 60);
  const s = Math.floor((diff / 1000) % 60);
  const pad = (n) => String(n).padStart(2, "0");
  return d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
}

/** A <span> that every page's ticker refreshes via its data-target timestamp. */
export function timerSpan(targetMs, extraClass = "") {
  const span = el("span", `timer ${extraClass}`.trim(), countdown(targetMs));
  span.dataset.target = String(targetMs);
  return span;
}

export function refreshTimers() {
  for (const node of document.querySelectorAll("[data-target]")) {
    node.textContent = countdown(Number(node.dataset.target));
  }
}

export function formatDate(iso) {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short", // e.g. "GMT+1" — always show which time zone a time is in
  });
}

/** "Nov 18, 12:00 GMT+1" (viewer's local time zone) */
export function shortDate(iso) {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
}

export function compactNumber(n) {
  if (typeof n !== "number") return "";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/* ---------- Data ---------- */

/** Loads the synced badge snapshot. Returns { badges, syncedAt }. */
export async function loadBadges() {
  try {
    const res = await fetch(DATA_URL, { cache: "no-cache" });
    if (res.ok) {
      const doc = await res.json();
      return { badges: doc.badges || [], syncedAt: doc.syncedAt || null };
    }
  } catch {}
  return { badges: [], syncedAt: null };
}

export async function gql(query, variables = {}) {
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

/** "@Name", "twitch.tv/name/videos" -> "name" */
export function normalizeLogin(raw) {
  return (raw || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/^.*twitch\.tv\//, "")
    .replace(/[/?#].*$/, "");
}

// Older versions stored the last searched username — remove it.
try {
  localStorage.removeItem("badgestatus_user");
} catch {}

/**
 * Re-checks the badge snapshot every `intervalMs` and calls `onChange(data)` when the sync
 * has published a newer one (new badges, times, owner counts, channels…). Pages use this to
 * stay current without a reload. Returns a function that stops watching.
 */
export function watchBadges(onChange, { syncedAt = null, intervalMs = 120_000 } = {}) {
  let last = syncedAt;
  const check = async () => {
    if (document.hidden) return;
    const data = await loadBadges();
    if (data.badges.length && data.syncedAt && data.syncedAt !== last) {
      last = data.syncedAt;
      onChange(data);
    }
  };
  const timer = setInterval(check, intervalMs);
  const onVisible = () => {
    if (!document.hidden) check();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/**
 * Overlays stay open for days (OBS, server stream). Reloads the page when /assets/version.json changes,
 * so design updates show up within a few minutes without restarting anything.
 */
export function reloadOnUpdate(intervalMs = 120_000) {
  let first = null;
  const check = async () => {
    try {
      const res = await fetch(`/assets/version.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const { v } = await res.json();
      if (first === null) first = v;
      else if (v !== first) location.reload();
    } catch {
      /* offline for a moment — try again next time */
    }
  };
  check();
  setInterval(check, intervalMs);
}
