import "../lib/background.js?v=30";
import { $, el, img, onImgError, badgeImg, badgeHref, showToast, loadBadges, watchBadges, compactNumber, gql } from "../lib/utils.js";
import { fetchChannel, earnableOnStream, paintLiveIndicators } from "../lib/twitch.js";
import { syncLiveEmbed } from "../lib/live-embed.js?v=1";
import { plannedMonth, plannedLabel } from "../lib/planned.js?v=1";

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
    timeZoneName: "short",
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

  // Part of a bigger campaign? → link to its collection page (/c/<game>/)
  const baseGame = (t) => String(t || "").replace(/\s*\((subscribe|watch|sub)\)\s*$/i, "").trim();
  const myGame = baseGame(badge.game);
  const link = $("bdCollection");
  link.classList.add("hidden");
  if (myGame && !/[,(]/.test(myGame)) {
    const sets = new Set(
      all.filter((b) => baseGame(b.game) === myGame && Date.parse(b.endAt || "") > Date.now() - 3 * 86_400_000).map((b) => b.setID)
    );
    if (sets.size >= 2) {
      const slug = myGame.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      link.href = `/c/${slug}/`;
      link.textContent = `See all ${sets.size} ${myGame} badges →`;
      link.classList.remove("hidden");
    }
  }
}

/* ---------- 2. When (updates every second) ---------- */

function renderWhen() {
  const s = statusOf(badge);
  const state = $("bdState");
  // no dates yet, but announced for a coming month → "Upcoming · Dec 2026"
  const planned = s === "unknown" ? plannedMonth(badge) : NaN;
  const label = planned > Date.now() ? `Upcoming · ${plannedLabel(planned)}` : STATE_LABEL[s];
  const cls = planned > Date.now() ? "bd-state is-upcoming" : `bd-state is-${s}`;
  // runs every second: only touch the page when something changed (no repaint → no flicker)
  if (state.textContent !== label) state.textContent = label;
  if (state.className !== cls) state.className = cls;

  if (s === "permanent" || s === "unknown") {
    if (!$("bdWhen").classList.contains("hidden")) $("bdWhen").classList.add("hidden");
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
  facts.push(fact("Channels", channelsValue()));
  if (typeof badge.userCount === "number") facts.push(fact("Owned by", `${compactNumber(badge.userCount)} users`));
  const nodes = facts;

  if (earnableOnStream(badge, channel) && !(plannedMonth(badge) > Date.now())) {
    const live = el("a", "bd-fact-v is-live", "Earnable on our stream ↗");
    live.href = "https://www.twitch.tv/badgestatus";
    live.target = "_blank";
    live.rel = "noopener noreferrer";
    nodes.push(fact("Live", live));
  }
  $("bdFacts").replaceChildren(...nodes);
}

/** Our stream is in this badge's category right now → embed it under the hero. */
function renderLiveBox() {
  const hero = document.querySelector(".bd-hero") || $("bdWhen");
  const now = Date.now();
  const open = !(Date.parse(badge.endAt || "") <= now) && !(Date.parse(badge.startAt || "") > now) && !(plannedMonth(badge) > now);
  syncLiveEmbed(hero, open && earnableOnStream(badge, channel), {
    title: "Get this badge right here",
    text: `We're live in ${channel?.game || "this category"} right now. Watch here to earn it.`,
  });
}

/* ---------- Channels + eligible live streams ---------- */

let liveInfo = new Map(); // login -> { displayName, avatar, stream }

function restrictedChannels() {
  return Array.isArray(badge.channels) ? badge.channels.filter((c) => c && c.login) : [];
}

/** "Any", "3 eligible channels", or clickable channel chips with avatars. */
function channelsValue() {
  const list = restrictedChannels();
  if (!list.length) return channelsText(badge);
  const wrap = el("span", "bd-fact-v bd-channels");
  for (const c of list) {
    const info = liveInfo.get(c.login);
    const a = el("a", "bd-channel");
    a.href = `https://www.twitch.tv/${encodeURIComponent(c.login)}`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    const avatar = info?.avatar || c.avatar;
    if (avatar) {
      const i = el("img");
      i.src = avatar;
      i.alt = "";
      i.width = 20;
      i.height = 20;
      a.appendChild(i);
    }
    a.appendChild(el("span", "", info?.displayName || c.displayName || c.login));
    if (info?.stream) {
      a.classList.add("is-live");
      a.appendChild(el("span", "bd-channel-live", "Live"));
    }
    wrap.appendChild(a);
  }
  return wrap;
}

function liveCard({ login, displayName, avatar, stream }) {
  const a = el("a", "bd-stream");
  a.href = `https://www.twitch.tv/${encodeURIComponent(login)}`;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.title = stream.title || displayName;

  const thumb = el("div", "bd-stream-thumb");
  const img = el("img");
  img.src = stream.preview || `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-440x248.jpg`;
  img.alt = "";
  img.loading = "lazy";
  thumb.append(img, el("span", "bd-stream-live", "Live"), el("span", "bd-stream-viewers", `${compactNumber(stream.viewers)} viewers`));

  const info = el("div", "bd-stream-info");
  if (avatar) {
    const av = el("img", "bd-stream-avatar");
    av.src = avatar;
    av.alt = "";
    info.appendChild(av);
  }
  const text = el("div", "bd-stream-text");
  text.append(el("span", "bd-stream-name", displayName), el("span", "bd-stream-title", stream.title || stream.game || ""));
  info.appendChild(text);

  a.append(thumb, info);
  return a;
}

function renderLive(streams, note) {
  const show = statusOf(badge) === "active";
  $("bdLiveWrap").classList.toggle("hidden", !show);
  if (!show) return;
  $("bdLiveNote").textContent = note || "";
  $("bdLive").replaceChildren(
    ...(streams.length ? streams.map(liveCard) : [el("div", "bd-live-empty", "Nothing here at the moment.")])
  );
}

/**
 * Restricted badges: live status of the listed channels.
 * Everything else: live streams with drops enabled in the badge's category.
 */
async function loadLive() {
  if (statusOf(badge) !== "active") return renderLive([]);
  const channels = restrictedChannels();
  try {
    if (channels.length) {
      const data = await gql(
        `query($logins: [String!]) {
          users(logins: $logins) {
            login displayName profileImageURL(width: 50)
            stream { id title viewersCount previewImageURL(width: 440, height: 248) game { displayName } }
          }
        }`,
        { logins: channels.map((c) => c.login) }
      );
      liveInfo = new Map();
      for (const u of data?.users || []) {
        if (!u) continue;
        liveInfo.set(u.login.toLowerCase(), {
          displayName: u.displayName,
          avatar: u.profileImageURL,
          stream: u.stream?.id
            ? { title: u.stream.title, viewers: u.stream.viewersCount, preview: u.stream.previewImageURL, game: u.stream.game?.displayName }
            : null,
        });
      }
      const live = [...liveInfo.entries()]
        .filter(([, v]) => v.stream)
        .map(([login, v]) => ({ login, ...v }))
        .sort((a, b) => b.stream.viewers - a.stream.viewers);
      renderHow(); // refresh channel chips (avatars, live dots)
      return renderLive(live, `${live.length} of ${channels.length} live`);
    }

    const category = firstCategory(badge);
    if (!category) return renderLive([]);
    const query = (filtered) => `query($name: String!) {
      game(name: $name) {
        streams(first: 8${filtered ? ", options: { systemFilters: [DROPS_ENABLED] }" : ""}) {
          edges { node { title viewersCount previewImageURL(width: 440, height: 248)
            broadcaster { login displayName profileImageURL(width: 50) } } }
        }
      }
    }`;
    let data;
    try {
      data = await gql(query(true), { name: category });
    } catch {
      data = await gql(query(false), { name: category }); // filter not supported → plain category streams
    }
    const live = (data?.game?.streams?.edges || [])
      .map((e) => e.node)
      .filter((n) => n?.broadcaster)
      .map((n) => ({
        login: n.broadcaster.login,
        displayName: n.broadcaster.displayName,
        avatar: n.broadcaster.profileImageURL,
        stream: { title: n.title, viewers: n.viewersCount, preview: n.previewImageURL },
      }));
    renderLive(live, live.length ? `Drops enabled · ${category}` : "");
  } catch {
    renderLive([]);
  }
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
  if (data.syncedAt) $("footerSync").textContent = `Updated ${localDate(data.syncedAt)}`;

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
  loadLive();
  setInterval(renderWhen, 1000);
  setInterval(loadLive, 120_000);

  const refresh = async () => {
    const next = await fetchChannel();
    if (next) channel = next;
    paintLiveIndicators(channel);
    renderHow();
    renderLiveBox();
  };
  refresh();
  setInterval(refresh, 60_000);

  // New snapshot from the sync (times, owners, channels…) → redraw this badge in place
  watchBadges(
    (next) => {
      const updated = next.badges.filter((b) => b.setID === id).sort((a, b) => Number(b.version) - Number(a.version))[0];
      if (!updated) return;
      all = next.badges;
      badge = updated;
      $("footerSync").textContent = `Updated ${localDate(next.syncedAt)}`;
      renderHero();
      renderWhen();
      renderHow();
      renderDetails();
      renderCampaign();
      renderOther();
      loadLive();
    },
    { syncedAt: data.syncedAt }
  );
}

init();
