import "../lib/background.js";
import { $, el, img, onImgError, badgeImg, badgeHref, showToast, loadBadges, compactNumber, gql } from "../lib/utils.js";
import { fetchChannel, earnableOnStream, paintLiveIndicators } from "../lib/twitch.js";

let badge = null;
let all = [];
let channel = null;
let game = null; // { name, slug, boxArt } from Twitch, once loaded

/* ---------- helpers ---------- */

function statusOf(b, now = Date.now()) {
  if (b.alwaysAvailable) return "permanent";
  const end = Date.parse(b.endAt || "");
  const start = Date.parse(b.startAt || "");
  if (Number.isNaN(end) && Number.isNaN(start)) return "unknown";
  if (!Number.isNaN(end) && end <= now) return "ended";
  if (!Number.isNaN(start) && start > now) return "upcoming";
  return "active";
}

function localDate(iso, opts = {}) {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString("en-US", {
    weekday: opts.weekday ? "short" : undefined,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "3 days 4 hours", "5 hours 12 minutes", "12 minutes 30 seconds" */
function longRel(ms) {
  const diff = Math.max(0, ms - Date.now());
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff / 3_600_000) % 24);
  const m = Math.floor((diff / 60_000) % 60);
  const s = Math.floor((diff / 1000) % 60);
  const part = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (d > 0) return `${part(d, "day")} ${part(h, "hour")}`;
  if (h > 0) return `${part(h, "hour")} ${part(m, "minute")}`;
  return `${part(m, "minute")} ${part(s, "second")}`;
}

/** "Grand Theft Auto VI (Subscribe)" and "... (Watch)" belong to the same campaign. */
function campaignOf(b) {
  return (b.eventName || "").trim().replace(/\s*\((subscribe|sub|watch)\)$/i, "");
}

/** "Watch 1h in QSMP (3 eligible channels)" -> "3 eligible channels" */
function channelsText(b) {
  const m = (b.objective || "").match(/\((\d+\s+eligible\s+channels?)\)/i);
  return m ? m[1].replace(/^./, (c) => c.toUpperCase()) : "Any";
}

function categoryText(b) {
  const g = (b.game || "").trim();
  if (g) return g;
  const m = (b.objective || "").match(/\bin\s+(.+?)(?:\s*\(|$)/i);
  return m ? m[1].trim() : "";
}

/** Twitch category slug: "Metaphor: ReFantazio" -> "metaphor-refantazio", "Tom Clancy's X" -> "tom-clancys-x" */
function twitchSlug(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Where to earn the badge on Twitch: the category's drops directory, or the drops campaigns page. */
function dropsLink(b) {
  const first = firstCategory(b);
  if (first) {
    const slug = game?.slug || twitchSlug(first);
    return { href: `https://www.twitch.tv/directory/category/${slug}?filter=drops`, label: `Get it on Twitch · ${game?.name || first}` };
  }
  return { href: "https://www.twitch.tv/drops/campaigns", label: "Get it on Twitch" };
}

/** First category of a badge, without "(+18 categories)" and extra names. */
function firstCategory(b) {
  if (/eligible\s+channels?/i.test(b.objective || "")) return "";
  return categoryText(b).replace(/\s*\(.*?\)\s*/g, "").split(",")[0].trim();
}

function fact(label, value) {
  const f = el("div", "bd-fact");
  const v = value instanceof Node ? value : el("span", "bd-fact-v", value);
  f.append(el("span", "bd-fact-k", label), v);
  return f;
}

/** Looks up the category on Twitch for its box art and exact slug. */
async function loadGame() {
  const name = firstCategory(badge);
  if (!name) return;
  try {
    const data = await gql(
      `query($name: String!) { game(name: $name) { displayName slug boxArtURL(width: 40, height: 54) } }`,
      { name }
    );
    const g = data?.game;
    if (g) game = { name: g.displayName || name, slug: g.slug || "", boxArt: g.boxArtURL || "" };
  } catch {}
  renderHow();
}

function costTag(b) {
  const paid = b.cost === "paid";
  return el("span", `tag ${paid ? "is-paid" : "is-free"}`, paid ? "Paid" : "Free");
}

/* ---------- 1. Hero ---------- */

const STATE_LABEL = {
  active: "Available now",
  upcoming: "Upcoming",
  ended: "Ended",
  permanent: "Always available",
  unknown: "Unknown",
};

function renderHero() {
  document.title = `${badge.title} — BadgeStatus`;
  $("bdCrumb").textContent = badge.title;
  $("bdTitle").textContent = badge.title;

  const hero = $("bdHeroImg");
  hero.src = img(badge, 4);
  hero.alt = badge.title;
  hero.addEventListener("error", onImgError);

  const paid = badge.cost === "paid";
  const cost = $("bdCost");
  cost.textContent = paid ? "Paid" : "Free";
  cost.className = `bd-cost ${paid ? "is-paid" : "is-free"}`;
}

/* ---------- 2. When (updates every second) ---------- */

function renderWhen() {
  const s = statusOf(badge);
  const state = $("bdState");
  state.textContent = STATE_LABEL[s];
  state.className = `bd-state is-${s}`;

  if (s === "permanent" || s === "unknown") {
    $("bdWhen").classList.add("hidden");
    return;
  }

  $("bdStart").textContent = localDate(badge.startAt, { weekday: true });
  $("bdEnd").textContent = localDate(badge.endAt, { weekday: true });

  const start = Date.parse(badge.startAt);
  const end = Date.parse(badge.endAt);
  const total = end - start;
  let pct = 0;
  if (s === "ended") pct = 100;
  else if (s === "active" && total > 0) pct = ((Date.now() - start) / total) * 100;
  $("bdProgress").style.width = `${Math.min(100, Math.max(0, pct))}%`;
  $("bdProgressWrap").className = `bd-progress is-${s}`;

  const cd = $("bdCountdown");
  cd.className = `bd-countdown is-${s}`;
  if (s === "active") cd.replaceChildren(el("span", "", "Ends in "), el("b", "", longRel(end)));
  else if (s === "upcoming") cd.replaceChildren(el("span", "", "Starts in "), el("b", "", longRel(start)));
  else cd.replaceChildren(el("span", "", "This badge can no longer be earned."));
}

/* ---------- 3. How to get it ---------- */

function renderHow() {
  $("bdHow").textContent = badge.objective?.trim() || badge.description?.trim() || "Not announced yet.";

  const facts = [];
  const category = firstCategory(badge);
  if (category) {
    // Category name + box art link to the category's Twitch drops page
    const value = el("a", "bd-fact-v bd-cat");
    value.href = dropsLink(badge).href;
    value.target = "_blank";
    value.rel = "noopener noreferrer";
    value.title = "Open drops for this category on Twitch";
    if (game?.boxArt) {
      const art = el("img", "bd-cat-art");
      art.src = game.boxArt;
      art.alt = "";
      art.width = 20;
      art.height = 27;
      value.appendChild(art);
    }
    value.appendChild(el("span", "bd-cat-name", game?.name || category));
    value.appendChild(el("span", "bd-cat-go", "Drops ↗"));
    facts.push(fact("Category", value));
  }
  facts.push(fact("Channels", channelsText(badge)));
  if (typeof badge.userCount === "number") facts.push(fact("Owned by", `${compactNumber(badge.userCount)} users`));
  const nodes = facts;

  if (earnableOnStream(badge, channel)) {
    const live = el("a", "bd-fact-v is-live", "Earnable on our stream ↗");
    live.href = "https://www.twitch.tv/badgestatus";
    live.target = "_blank";
    live.rel = "noopener noreferrer";
    nodes.push(fact("Live", live));
  }
  $("bdFacts").replaceChildren(...nodes);
}

/* ---------- 4. Details ---------- */

function row(label, value) {
  const wrap = el("div");
  const dd = el("dd");
  if (value instanceof Node) dd.appendChild(value);
  else dd.textContent = value || "—";
  wrap.append(el("dt", "", label), dd);
  return wrap;
}

function renderDetails() {
  for (const [id, size] of [
    ["bdImg1", 1],
    ["bdImg2", 2],
    ["bdImg4", 4],
  ]) {
    const node = $(id);
    node.src = img(badge, size);
    node.alt = `${badge.title} ${size}x`;
    node.addEventListener("error", onImgError);
  }
  $("bdChatImg").src = img(badge, 1);

  const links = el("span", "bd-links");
  const sdb = el("a", "", "StreamDatabase ↗");
  sdb.href = `https://www.streamdatabase.com/twitch/global-badges/${encodeURIComponent(badge.setID)}/${encodeURIComponent(badge.version || "1")}`;
  sdb.target = "_blank";
  sdb.rel = "noopener noreferrer";
  const copy = el("button", "", "Copy image URL");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(img(badge));
      showToast("Image URL copied");
    } catch {
      showToast("Copy failed");
    }
  });
  links.append(sdb, copy);

  $("bdData").replaceChildren(
    row("Description", badge.description?.trim()),
    row("Set ID", el("span", "mono-dd", badge.setID)),
    row("Version", el("span", "mono-dd", badge.version || "1")),
    row("Added", localDate(badge.firstSeen)),
    row("Links", links)
  );
}

/* ---------- 5. Related ---------- */

function renderCampaign() {
  const campaign = campaignOf(badge);
  const seen = new Set([badge.setID]);
  const siblings = campaign
    ? all
        .filter((b) => campaignOf(b) === campaign && !seen.has(b.setID) && seen.add(b.setID))
        .sort((a, b) => (a.cost === "paid") - (b.cost === "paid") || Date.parse(a.startAt) - Date.parse(b.startAt))
    : [];
  $("bdCampaignWrap").classList.toggle("hidden", siblings.length === 0);
  if (!siblings.length) return;

  $("bdCampaignTitle").textContent = `More from ${campaign}`;
  $("bdCampaign").replaceChildren(
    ...siblings.map((b) => {
      const r = el("a", "mini-row");
      r.href = badgeHref(b);
      const title = el("span", "mini-title", b.title);
      if (b.objective) title.appendChild(el("span", "mini-sub", b.objective));
      const side = el("span", "mini-side");
      side.appendChild(costTag(b));
      r.append(badgeImg(b, "mini-img", 2), title, side);
      return r;
    })
  );
}

function renderOther() {
  const now = Date.now();
  const campaign = campaignOf(badge);
  const seen = new Set([badge.setID]);
  const pick = [];
  const push = (b) => {
    if (seen.has(b.setID)) return;
    seen.add(b.setID);
    pick.push(b);
  };
  all
    .filter((b) => campaignOf(b) !== campaign && ["active", "upcoming"].includes(statusOf(b, now)))
    .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt))
    .forEach(push);
  all
    .slice()
    .sort((a, b) => Date.parse(b.firstSeen || 0) - Date.parse(a.firstSeen || 0))
    .forEach(push);

  $("bdOther").replaceChildren(
    ...pick.slice(0, 16).map((b) => {
      const a = el("a", "bd-other-item");
      a.href = badgeHref(b);
      a.title = b.title;
      a.appendChild(badgeImg(b, "", 4));
      return a;
    })
  );
}

/* ---------- init ---------- */

for (const btn of document.querySelectorAll(".bd-theme button")) {
  btn.addEventListener("click", () => {
    for (const b of document.querySelectorAll(".bd-theme button")) b.classList.toggle("is-active", b === btn);
    $("bdPreview").classList.toggle("is-light", btn.dataset.theme === "light");
  });
}

async function init() {
  const id = new URLSearchParams(location.search).get("id") || "";
  const data = await loadBadges();
  all = data.badges;
  if (data.syncedAt) $("footerSync").textContent = `Synced ${localDate(data.syncedAt)}`;

  $("bdLoading").classList.add("hidden");
  // Prefer the newest version of a set
  badge = all.filter((b) => b.setID === id).sort((a, b) => Number(b.version) - Number(a.version))[0] || null;

  if (!badge) {
    $("bdNotFound").classList.remove("hidden");
    return;
  }

  $("bd").classList.remove("hidden");
  renderHero();
  renderWhen();
  renderHow();
  renderDetails();
  renderCampaign();
  renderOther();
  loadGame();
  setInterval(renderWhen, 1000);

  const refresh = async () => {
    const next = await fetchChannel();
    if (next) channel = next;
    paintLiveIndicators(channel);
    renderHow();
  };
  refresh();
  setInterval(refresh, 60_000);
}

init();
