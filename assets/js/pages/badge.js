import "../lib/background.js";
import { $, el, img, onImgError, badgeHref, showToast, loadBadges } from "../lib/utils.js";
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

function localDate(iso, withSeconds = false) {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return "N/A";
  return (
    new Date(t).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      ...(withSeconds ? { second: "2-digit" } : {}),
      hour12: false,
    }) + " (Local)"
  );
}

function shortRange(iso) {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return "TBA";
  return new Date(t).toLocaleString("en-US", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
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

/** Category without the "(+18 categories)" suffix kept separately. */
function categoryText(b) {
  const g = (b.game || "").trim();
  if (g) return g;
  const m = (b.objective || "").match(/\bin\s+(.+?)(?:\s*\(|$)/i);
  return m ? m[1].trim() : "N/A";
}

/* ---------- rendering ---------- */

function renderStatus() {
  const s = statusOf(badge);
  const node = $("bdStatus");
  node.className = "bd-status";
  if (s === "upcoming") {
    node.classList.add("is-upcoming");
    node.textContent = `Starts in ${longRel(Date.parse(badge.startAt))}`;
  } else if (s === "active") {
    node.classList.add("is-active");
    node.textContent = `Ends in ${longRel(Date.parse(badge.endAt))}`;
  } else if (s === "ended") {
    node.classList.add("is-ended");
    node.textContent = "No longer available";
  } else if (s === "permanent") {
    node.classList.add("is-active");
    node.textContent = "Always available";
  } else {
    node.classList.add("is-ended");
    node.textContent = "Availability unknown";
  }
}

function contextBlock() {
  const box = $("bdContext");
  box.replaceChildren();
  const s = statusOf(badge);
  const event = campaignOf(badge);
  const free = badge.cost !== "paid";

  const intro = el("p");
  const strong = el("b", "", badge.title);
  intro.append(strong);
  if (s === "permanent") intro.append(" is a permanent Twitch global chat badge.");
  else if (event) intro.append(` is a limited-time global chat badge from the `, el("b", "", event), " campaign.");
  else intro.append(" is a Twitch global chat badge.");
  box.appendChild(intro);

  if (badge.objective) {
    const how = el("p");
    how.append("To earn it: ", el("span", "bd-em", badge.objective.replace(/\.$/, "")), ".");
    if (!free) how.append(" Prime Gaming subs usually don't count.");
    box.appendChild(how);
  }

  if (badge.startAt || badge.endAt) {
    const dur = el("p", "bd-duration");
    dur.append(s === "ended" ? "Was available: " : "Event duration: ", el("span", "bd-chip", shortRange(badge.startAt)), " – ", el("span", "bd-chip", shortRange(badge.endAt)));
    box.appendChild(dur);
  }

  if (s === "active" || s === "upcoming") {
    box.appendChild(el("p", "", "The badge is granted automatically once you meet the requirement while the event is running."));
  }

  if (event) {
    const seen = new Set([badge.setID]);
    const siblings = all
      .filter((b) => campaignOf(b) === event && !seen.has(b.setID) && seen.add(b.setID))
      .sort((a, b) => (a.cost === "paid") - (b.cost === "paid") || Date.parse(a.startAt) - Date.parse(b.startAt));
    if (siblings.length) {
      box.appendChild(el("p", "bd-list-title", "Other badges from this campaign:"));
      const ul = el("ul", "bd-list");
      for (const b of siblings) {
        const li = el("li");
        const a = el("a", "", b.title);
        a.href = badgeHref(b);
        const icon = el("img");
        icon.src = img(b, 1);
        icon.alt = "";
        icon.addEventListener("error", onImgError);
        const note = b.objective ? `${b.cost === "paid" ? "paid" : "free"} · ${b.objective}` : b.cost === "paid" ? "paid" : "free";
        li.append(icon, a, el("span", "muted", ` (${note})`));
        ul.appendChild(li);
      }
      box.appendChild(ul);
    }
  }
}

function renderOther() {
  const grid = $("bdOther");
  const now = Date.now();
  const event = campaignOf(badge);
  const seen = new Set([badge.setID]);
  const pick = [];
  const push = (b) => {
    if (seen.has(b.setID)) return;
    seen.add(b.setID);
    pick.push(b);
  };
  if (event) all.filter((b) => campaignOf(b) === event).forEach(push);
  all
    .filter((b) => {
      const s = statusOf(b, now);
      return s === "active" || s === "upcoming";
    })
    .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt))
    .forEach(push);
  all
    .slice()
    .sort((a, b) => Date.parse(b.firstSeen || 0) - Date.parse(a.firstSeen || 0))
    .forEach(push);

  grid.replaceChildren(
    ...pick.slice(0, 12).map((b) => {
      const a = el("a", "bd-other-item");
      a.href = badgeHref(b);
      a.title = b.title;
      const i = el("img");
      i.src = img(b);
      i.alt = b.title;
      i.loading = "lazy";
      i.addEventListener("error", onImgError);
      a.appendChild(i);
      return a;
    })
  );
}

function renderLive() {
  paintLiveIndicators(channel);
  const pill = $("bdLivePill");
  const live = Boolean(channel?.live);
  pill.textContent = live ? "Live" : "Offline";
  pill.classList.toggle("is-live", live);
  if (earnableOnStream(badge, channel)) {
    $("bdLiveText").textContent = `We're live in ${channel.game} right now — watch on our stream to earn ${badge.title}.`;
  } else if (live) {
    $("bdLiveText").textContent = `We're live${channel.game ? ` in ${channel.game}` : ""} with 24/7 badge countdowns and drops.`;
  }
}

function render() {
  document.title = `${badge.title} — BadgeStatus`;
  $("bdCrumb").textContent = badge.title;
  $("bdTitle").textContent = badge.title;

  for (const [id, size] of [["bdImg1", 1], ["bdImg2", 2], ["bdImg4", 4]]) {
    const node = $(id);
    node.src = img(badge, size);
    node.alt = `${badge.title} ${size}x`;
    node.addEventListener("error", onImgError);
  }
  $("bdChatImg").src = img(badge, 1);

  $("bdDataTitle").textContent = badge.title;
  $("bdDataDesc").textContent = badge.description?.trim() || "N/A";
  $("bdDataSet").textContent = badge.setID;
  $("bdDataVersion").textContent = badge.version || "1";
  $("bdDataAction").textContent = badge.clickAction || "N/A";
  const url = $("bdDataUrl");
  if (badge.clickURL) {
    const a = el("a", "bd-link", badge.clickURL);
    a.href = badge.clickURL;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    url.replaceChildren(a);
  } else url.textContent = "N/A";

  renderStatus();
  const cost = $("bdCost");
  cost.textContent = badge.cost === "paid" ? "Paid" : "Free";
  cost.className = `bd-tag ${badge.cost === "paid" ? "is-paid" : "is-free"}`;
  $("bdObjective").textContent = badge.objective?.trim() || "Not announced yet.";
  $("bdCategory").textContent = categoryText(badge);
  $("bdChannels").textContent = channelsText(badge);
  $("bdStart").textContent = badge.alwaysAvailable ? "Always" : localDate(badge.startAt);
  $("bdEnd").textContent = badge.alwaysAvailable ? "Never" : localDate(badge.endAt);

  contextBlock();

  $("bdUsers").textContent = typeof badge.userCount === "number" ? badge.userCount.toLocaleString("en-US") : "N/A";
  $("bdSdb").href = `https://www.streamdatabase.com/twitch/global-badges/${encodeURIComponent(badge.setID)}/${encodeURIComponent(badge.version || "1")}`;

  $("bdAdded").textContent = localDate(badge.firstSeen, true);
  $("bdUpdated").textContent = localDate(badge.lastUpdated, true);

  renderOther();
  renderLive();
}

/* ---------- init ---------- */

for (const btn of document.querySelectorAll(".bd-theme button")) {
  btn.addEventListener("click", () => {
    for (const b of document.querySelectorAll(".bd-theme button")) b.classList.toggle("is-active", b === btn);
    $("bdPreview").classList.toggle("is-light", btn.dataset.theme === "light");
  });
}

$("bdCopy").addEventListener("click", async () => {
  if (!badge) return;
  try {
    await navigator.clipboard.writeText(img(badge));
    showToast("Image URL copied");
  } catch {
    showToast("Copy failed");
  }
});

async function init() {
  const id = new URLSearchParams(location.search).get("id") || "";
  const data = await loadBadges();
  all = data.badges;
  if (data.syncedAt) $("footerSync").textContent = `Schedule synced ${localDate(data.syncedAt).replace(" (Local)", "")}`;

  $("bdLoading").classList.add("hidden");
  const matches = all.filter((b) => b.setID === id);
  // Prefer the newest version of a set
  badge = matches.sort((a, b) => Number(b.version) - Number(a.version))[0] || null;

  if (!badge) {
    $("bdNotFound").classList.remove("hidden");
    return;
  }

  $("bd").classList.remove("hidden");
  render();
  setInterval(renderStatus, 1000);

  const refresh = async () => {
    const next = await fetchChannel();
    if (next) channel = next;
    renderLive();
  };
  refresh();
  setInterval(refresh, 60_000);
}

init();
