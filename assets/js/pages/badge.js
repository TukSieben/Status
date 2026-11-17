import "../lib/background.js";
import { $, el, img, onImgError, badgeImg, badgeHref, showToast, loadBadges, timerSpan, refreshTimers, compactNumber } from "../lib/utils.js";
import { fetchChannel, earnableOnStream, paintLiveIndicators } from "../lib/twitch.js";

let badge = null;
let all = [];
let channel = null;

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

function localDate(iso) {
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
  return m ? m[1].trim() : "—";
}

function costTag(b) {
  const paid = b.cost === "paid";
  return el("span", `tag ${paid ? "is-paid" : "is-free"}`, paid ? "Paid" : "Free");
}

/* ---------- rendering ---------- */

function renderMeta() {
  const meta = $("bdMeta");
  const s = statusOf(badge);
  const items = [];

  const status = el("span");
  if (s === "active" || s === "upcoming") {
    const b = el("b", s === "active" ? "amber" : "");
    b.appendChild(timerSpan(Date.parse(s === "active" ? badge.endAt : badge.startAt)));
    status.append(s === "active" ? "Ends in " : "Starts in ", b);
  } else {
    const label = s === "permanent" ? "Always available" : s === "ended" ? "Ended" : "Unknown";
    status.appendChild(el("b", s === "permanent" ? "green" : "", label));
  }
  items.push(status);

  const cost = el("span");
  cost.appendChild(el("b", badge.cost === "paid" ? "amber" : "green", badge.cost === "paid" ? "Paid" : "Free"));
  items.push(cost);

  if (typeof badge.userCount === "number") {
    const users = el("span");
    users.append(el("b", "", compactNumber(badge.userCount)), " users");
    items.push(users);
  }

  if (earnableOnStream(badge, channel)) {
    const live = el("a");
    live.href = "https://www.twitch.tv/badgestatus";
    live.target = "_blank";
    live.rel = "noopener noreferrer";
    live.appendChild(el("b", "is-live-text", "Earnable on our stream ↗"));
    items.push(live);
  }

  meta.replaceChildren(...items);
}

function row(label, value) {
  const wrap = el("div");
  const dd = el("dd");
  if (value instanceof Node) dd.appendChild(value);
  else dd.textContent = value || "—";
  wrap.append(el("dt", "", label), dd);
  return wrap;
}

function renderData() {
  const rows = [];
  rows.push(row("How to get it", badge.objective?.trim() || "Not announced yet."));
  rows.push(row("Category", categoryText(badge)));
  rows.push(row("Channels", channelsText(badge)));
  if (badge.alwaysAvailable) rows.push(row("Available", "Always"));
  else {
    rows.push(row("Starts", localDate(badge.startAt)));
    rows.push(row("Ends", localDate(badge.endAt)));
  }
  rows.push(row("Description", badge.description?.trim()));

  const ids = el("span", "mono-dd", `${badge.setID} · v${badge.version || "1"}`);
  rows.push(row("Set ID", ids));
  rows.push(row("Added", localDate(badge.firstSeen)));

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
  rows.push(row("Links", links));

  $("bdData").replaceChildren(...rows);
}

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

function render() {
  document.title = `${badge.title} — BadgeStatus`;
  $("bdCrumb").textContent = badge.title;
  $("bdTitle").textContent = badge.title;

  const head = $("bdHeadImg");
  head.src = img(badge, 4);
  head.alt = badge.title;
  head.addEventListener("error", onImgError);

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

  renderMeta();
  renderData();
  renderCampaign();
  renderOther();
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
  render();
  setInterval(refreshTimers, 1000);

  const refresh = async () => {
    const next = await fetchChannel();
    if (next) channel = next;
    paintLiveIndicators(channel);
    renderMeta();
  };
  refresh();
  setInterval(refresh, 60_000);
}

init();
