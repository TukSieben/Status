// Badge collection: every badge of one campaign/game at a glance — watch badges, sub badges (+ emotes),
// and the final badge you get for all of them. Optional check of a Twitch name (not stored).
// /collection/?game=Grand%20Theft%20Auto%20VI · /gta6/ is preset for GTA VI.
import "../lib/background.js?v=31";
import { $, el, badgeImg, badgeHref, loadBadges, watchBadges, gql, normalizeLogin, extractUuid } from "../lib/utils.js";
import { fetchChannel, earnableOnStream, paintLiveIndicators } from "../lib/twitch.js";
import { syncLiveEmbed } from "../lib/live-embed.js?v=1";

const params = new URLSearchParams(location.search);
const GAME = (params.get("game") || document.body.dataset.game || "").trim();

/** Rewards Twitch announced next to the badges (not in the badge data) */
const EXTRAS = {
  "grand theft auto vi": { emotes: ["BustedPlz", "DinoBusted", "SabaBusted"], short: "GTA VI" },
};
const extra = EXTRAS[GAME.toLowerCase()] || { emotes: [] };

let badges = [];
const owned = { user: null, setIDs: new Set(), uuids: new Set() };

const base = (t) => String(t || "").replace(/\s*\((subscribe|watch|sub)\)\s*$/i, "").trim().toLowerCase();
const isFinal = (b) => /all the emotes and badges|securing all|collect(ing)? all/i.test(b.description || "");
const isSub = (b) => /subscri|gift/i.test(b.objective || "") || /\((subscribe|sub)\)/i.test(`${b.game} ${b.eventName}`);
const watchTime = (b) => String(b.objective || "").match(/^watch\s+(.+?)\s+in\s/i)?.[1] || null;
const days = (b) => Number(String(b.description || "").match(/watching\s+(\d+)\s+days?/i)?.[1] || 0);
const pretty = (t) => (t || "").replace(/^(\d+)h$/, (_, h) => `${h} hour${h === "1" ? "" : "s"}`).replace(/^(\d+)m$/, "$1 min");
const isOwned = (b) => owned.setIDs.has(b.setID) || owned.uuids.has(extractUuid(b.image4x || b.image1x || ""));

function rel(ms) {
  const diff = Math.max(0, ms - Date.now());
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff / 3_600_000) % 24);
  const m = Math.floor((diff / 60_000) % 60);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
}
const dateText = (ms) =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" });

function gameBadges() {
  const g = GAME.toLowerCase();
  const bySet = new Map();
  for (const b of badges) {
    if (base(b.game) !== g && base(b.eventName) !== g) continue;
    const prev = bySet.get(b.setID);
    if (!prev || Number(b.version) > Number(prev.version)) bySet.set(b.setID, b);
  }
  return [...bySet.values()].filter((b) => Date.parse(b.endAt || "") > Date.now() - 3 * 86_400_000);
}

function card(b, how, step) {
  const a = el("a", "co-card");
  a.href = badgeHref(b);
  if (owned.user) {
    const has = isOwned(b);
    a.classList.add(has ? "is-owned" : "is-missing");
    a.append(el("span", "co-flag", has ? "Owned" : "Missing"));
  }
  a.append(badgeImg(b, "", 4));
  if (step) a.append(el("span", "co-card-step", step));
  a.append(el("span", "co-card-name", b.title), el("span", "co-card-how", how));
  return a;
}

function render() {
  const list = gameBadges();
  $("coLoading").classList.add("hidden");
  if (!GAME || !list.length) {
    $("coNotFound").classList.remove("hidden");
    $("co").classList.add("hidden");
    return;
  }
  $("coNotFound").classList.add("hidden");
  $("co").classList.remove("hidden");

  const final = list.find(isFinal);
  const watch = list.filter((b) => b !== final && !isSub(b)).sort((a, b) => days(a) - days(b) || a.title.localeCompare(b.title));
  const subs = list.filter((b) => b !== final && isSub(b)).sort((a, b) => a.title.localeCompare(b.title));
  const total = watch.length + subs.length + extra.emotes.length;
  const short = extra.short || GAME;

  document.title = `${GAME} badges — BadgeStatus`;
  $("coTitle").textContent = GAME;
  $("coSub").textContent = final
    ? `${total} rewards: ${watch.length} free badges for watching, ${subs.length} badges${extra.emotes.length ? ` and ${extra.emotes.length} emotes` : ""} for subs. Collect all of them for the ${final.title}.`
    : `${watch.length} free badges for watching${subs.length ? ` and ${subs.length} for subs` : ""}.`;

  const end = Math.min(...list.map((b) => Date.parse(b.endAt || "") || Infinity));
  const time = $("coTime");
  time.replaceChildren();
  if (Number.isFinite(end)) {
    time.append(el("b", "", end > Date.now() ? rel(end) : "Ended"), `Ends ${dateText(end)}`);
  }

  // final badge
  const fin = $("coFinal");
  fin.classList.toggle("hidden", !final);
  if (final) {
    const text = el("div");
    text.append(el("h2", "", final.title), el("p", "", `Unlocks automatically once you have all ${total} rewards below — every chain, every sub badge${extra.emotes.length ? " and every emote" : ""}.`));
    const count = el("div", "co-count");
    if (owned.user) {
      const have = [...watch, ...subs].filter(isOwned).length;
      count.append(el("b", "", isOwned(final) ? "Owned" : `${have}/${watch.length + subs.length}`), isOwned(final) ? "you have it" : "badges so far");
    } else count.append(el("b", "", String(total)), "rewards needed");
    const link = el("a");
    link.href = badgeHref(final);
    link.append(badgeImg(final, "", 4));
    fin.replaceChildren(link, text, count);
  }

  // watch badges
  const times = [...new Set(watch.map(watchTime).filter(Boolean))];
  const daily = watch.some((b) => days(b) > 0);
  $("coWatchSec").classList.toggle("hidden", !watch.length);
  $("coWatchPill").textContent = times.length === 1 ? `Free · ${pretty(times[0])}${daily ? " a day" : ""}` : "Free";
  $("coWatch").replaceChildren(
    ...watch.map((b) => {
      const d = days(b);
      const t = watchTime(b);
      return card(b, d ? `${t ? pretty(t) : "Watch"} on ${d} day${d === 1 ? "" : "s"}` : t ? `Watch ${pretty(t)}` : "Watch", d ? `Day ${d}` : "");
    })
  );

  // sub badges + emotes
  $("coSubSec").classList.toggle("hidden", !subs.length && !extra.emotes.length);
  $("coSubPill").textContent = subs.length > 1 ? `1 sub = 1 badge${extra.emotes.length ? " + 1 emote" : ""}` : "Paid";
  $("coSubs").replaceChildren(...subs.map((b) => card(b, "1 new sub or gift sub")));
  const em = $("coEmotes");
  em.classList.toggle("hidden", !extra.emotes.length);
  em.replaceChildren(
    "Emotes (can't be checked):",
    ...extra.emotes.map((n) => el("span", "co-emote", n))
  );

  // tips
  const tips = [];
  if (watch.length) tips.push(["Watch any ", el("b", "", short), " stream", daily ? ` for ${times[0] ? pretty(times[0]) : "a while"} — come back the next day for the next one.` : "."]);
  if (subs.length) tips.push([el("b", "", "Prime subs don't count."), ` A new recurring sub or a gift sub to any streamer in ${short} works — different streamers are fine.`]);
  if (subs.length) tips.push(["Already subbed to a streamer? Gift a sub there instead."]);
  tips.push(["Track your progress at ", Object.assign(el("a", "", "twitch.tv/drops/inventory"), { href: "https://www.twitch.tv/drops/inventory", target: "_blank", rel: "noopener noreferrer" }), "."]);
  $("coTips").replaceChildren(
    ...tips.map((parts) => {
      const li = el("li");
      li.append(...parts);
      return li;
    })
  );

  // result line
  const res = $("coResult");
  res.classList.toggle("hidden", !owned.user);
  if (owned.user) {
    const have = [...watch, ...subs].filter(isOwned).length;
    const all = watch.length + subs.length;
    const av = el("img");
    av.src = owned.user.profileImageURL;
    av.alt = "";
    const bar = el("div", "co-bar");
    const fill = el("span");
    fill.style.width = `${all ? Math.round((have / all) * 100) : 0}%`;
    bar.append(fill);
    const strong = el("b", "", owned.user.displayName);
    res.replaceChildren(av, strong, ` has ${have} of ${all} badges${extra.emotes.length ? " (emotes can't be checked)" : ""}.`, bar);
  }
}

async function check(raw) {
  const login = normalizeLogin(raw);
  if (!login) return;
  $("coUser").value = login;
  $("coError").classList.add("hidden");
  $("coBtn").disabled = true;
  $("coBtnLabel").classList.add("hidden");
  $("coSpin").classList.remove("hidden");
  try {
    const data = await gql(
      `query($login: String!) {
        user(login: $login) { id login displayName profileImageURL(width: 70) }
        channelViewer(channelLogin: $login, userLogin: $login) { earnedBadges { setID imageURL(size: QUADRUPLE) } }
      }`,
      { login }
    );
    if (!data?.user?.id) throw new Error(`Twitch user "${login}" was not found.`);
    owned.user = data.user;
    owned.setIDs = new Set();
    owned.uuids = new Set();
    for (const b of data.channelViewer?.earnedBadges || []) {
      if (b.setID) owned.setIDs.add(b.setID);
      const u = extractUuid(b.imageURL);
      if (u) owned.uuids.add(u);
    }
    const url = new URL(location.href);
    url.searchParams.set("user", data.user.login);
    history.replaceState(null, "", url);
    render();
  } catch (e) {
    $("coError").textContent = e?.message || "Could not check this user.";
    $("coError").classList.remove("hidden");
  } finally {
    $("coBtn").disabled = false;
    $("coBtnLabel").classList.remove("hidden");
    $("coSpin").classList.add("hidden");
  }
}

$("coForm").addEventListener("submit", (e) => {
  e.preventDefault();
  check($("coUser").value);
});

const data = await loadBadges();
badges = data.badges;
render();
if (params.get("user")) check(params.get("user"));
watchBadges(
  (next) => {
    badges = next.badges;
    render();
  },
  { syncedAt: data.syncedAt, intervalMs: 120_000 }
);

/* ---------- Live box: our stream is in this game right now ---------- */
let channel = null;

function renderLiveBox() {
  const list = gameBadges();
  const watchList = list.filter((b) => !isSub(b) && !isFinal(b));
  const live = Boolean(channel?.live) && list.length > 0 &&
    (base(channel.game) === GAME.toLowerCase() || watchList.some((b) => earnableOnStream(b, channel)));
  const head = document.querySelector(".co-head");
  if (!head) return;
  syncLiveEmbed(head, live, {
    title: watchList.length > 1 ? "Get these badges right here" : "Get this badge right here",
    text: `We're live in ${channel?.game || GAME} right now. Watching here counts toward the free watch badges.`,
  });
}

async function refreshChannel() {
  const next = await fetchChannel().catch(() => null);
  if (next) channel = next;
  paintLiveIndicators(channel);
  renderLiveBox();
}
refreshChannel();
setInterval(refreshChannel, 60_000);
