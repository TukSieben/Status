// Compare the earned Twitch badges of two accounts. Names only live in the URL (?a=&b=), nothing is stored.
import "../lib/background.js?v=31";
import { $, el, badgeImg, badgeHref, extractUuid, img, loadBadges, gql, normalizeLogin, splitBadges, formatDate } from "../lib/utils.js";
import { paintLiveIndicators, fetchChannel } from "../lib/twitch.js";

let badges = [];
let byUuid = new Map();
const MAX_ICONS = 60;

function indexBadges() {
  byUuid = new Map();
  for (const b of badges) {
    const u = extractUuid(img(b));
    if (u && !byUuid.has(u)) byUuid.set(u, b);
  }
}

async function fetchUser(login) {
  const data = await gql(
    `query CompareUser($login: String!) {
      user(login: $login) { id login displayName profileImageURL(width: 70) }
      channelViewer(channelLogin: $login, userLogin: $login) { earnedBadges { setID version imageURL(size: QUADRUPLE) } }
    }`,
    { login }
  );
  if (!data?.user?.id) throw new Error(`Twitch user "${login}" was not found.`);
  const uuids = new Set();
  for (const b of data.channelViewer?.earnedBadges || []) {
    const u = extractUuid(b.imageURL);
    if (u) uuids.add(u);
  }
  return { user: data.user, uuids };
}

const rarity = (b) => (typeof b.userCount === "number" ? b.userCount : Number.MAX_SAFE_INTEGER);
const byRarity = (a, b) => rarity(a) - rarity(b) || a.title.localeCompare(b.title);

function icons(host, list) {
  const shown = list.slice(0, MAX_ICONS).map((b) => {
    const a = el("a", "cmp-icon");
    a.href = badgeHref(b);
    a.title = typeof b.userCount === "number" ? `${b.title} · ${b.userCount.toLocaleString("en-US")} owners` : b.title;
    a.appendChild(badgeImg(b, "", 2));
    return a;
  });
  if (list.length > MAX_ICONS) shown.push(el("span", "cmp-more", `+${list.length - MAX_ICONS}`));
  host.replaceChildren(...(shown.length ? shown : [el("div", "cmp-none", "None")]));
}

function playerCard(host, p, known, activeOwned, activeTotal, winner) {
  const rarest = known.slice().sort(byRarity)[0];
  const av = el("img", "cmp-avatar");
  av.src = p.user.profileImageURL || "/assets/img/logo.png";
  av.alt = "";
  const top = el("div", "cmp-player-top");
  const name = el("div", "cmp-name", p.user.displayName || p.user.login);
  if (winner) name.appendChild(el("span", "cmp-crown", "Winner"));
  top.append(av, name);
  const stats = el("div", "cmp-stats");
  const stat = (num, label) => {
    const s = el("div", "cmp-stat");
    s.append(el("b", "", num), el("span", "", label));
    return s;
  };
  stats.append(stat(String(p.uuids.size), "badges"), stat(`${activeOwned}/${activeTotal}`, "of the current ones"));
  host.replaceChildren(top, stats);
  if (rarest && typeof rarest.userCount === "number") {
    const r = el("a", "cmp-rarest");
    r.href = badgeHref(rarest);
    const t = el("div", "cmp-rarest-text");
    t.append(el("span", "cmp-rarest-label", "Rarest"), el("span", "cmp-rarest-title", rarest.title), el("span", "cmp-rarest-sub", `${rarest.userCount.toLocaleString("en-US")} owners`));
    r.append(badgeImg(rarest, "cmp-rarest-img", 2), t);
    host.appendChild(r);
  }
}

function setLoading(on) {
  $("cmpBtn").disabled = on;
  $("cmpLabel").classList.toggle("hidden", on);
  $("cmpSpin").classList.toggle("hidden", !on);
}

async function compare(rawA, rawB) {
  const a = normalizeLogin(rawA);
  const b = normalizeLogin(rawB);
  if (!a || !b) return;
  $("cmpA").value = a;
  $("cmpB").value = b;
  $("errorBox").classList.add("hidden");
  setLoading(true);
  try {
    const [A, B] = await Promise.all([fetchUser(a), fetchUser(b)]);
    const url = new URL(location.href);
    url.searchParams.set("a", A.user.login);
    url.searchParams.set("b", B.user.login);
    history.replaceState(null, "", url);

    const known = (p) => [...p.uuids].map((u) => byUuid.get(u)).filter(Boolean);
    const kA = known(A), kB = known(B);
    const onlyA = kA.filter((x) => !B.uuids.has(extractUuid(img(x)))).sort(byRarity);
    const onlyB = kB.filter((x) => !A.uuids.has(extractUuid(img(x)))).sort(byRarity);
    const both = kA.filter((x) => B.uuids.has(extractUuid(img(x)))).sort(byRarity);

    const { active } = splitBadges(badges);
    const activeOwned = (p) => active.filter((x) => p.uuids.has(extractUuid(img(x)))).length;
    const nA = A.uuids.size, nB = B.uuids.size;
    const nameA = A.user.displayName || A.user.login, nameB = B.user.displayName || B.user.login;

    const banner = $("cmpBanner");
    const alien = el("img", "cmp-alien");
    alien.alt = "";
    alien.dataset.alien = nA === nB ? "confused" : "happy";
    alien.src = `/assets/img/aliens/${alien.dataset.alien}${document.documentElement.classList.contains("is-winter") ? "-winter" : ""}.png`;
    const text = el("div", "cmp-banner-text");
    if (nA === nB) text.append(el("b", "", "It's a tie!"), el("span", "", `You both have ${nA} badges.`));
    else {
      const [w, l, d] = nA > nB ? [nameA, nameB, nA - nB] : [nameB, nameA, nB - nA];
      text.append(el("b", "", `${w} wins`), el("span", "", `${d} more badge${d === 1 ? "" : "s"} than ${l}.`));
    }
    banner.replaceChildren(alien, text);

    playerCard($("cmpPlayerA"), A, kA, activeOwned(A), active.length, nA > nB);
    playerCard($("cmpPlayerB"), B, kB, activeOwned(B), active.length, nB > nA);
    $("cmpOnlyAHead").textContent = `Only ${nameA} (${onlyA.length})`;
    $("cmpBothHead").textContent = `Both (${both.length})`;
    $("cmpOnlyBHead").textContent = `Only ${nameB} (${onlyB.length})`;
    icons($("cmpOnlyA"), onlyA);
    icons($("cmpBoth"), both);
    icons($("cmpOnlyB"), onlyB);
    $("cmpResult").classList.remove("hidden");
  } catch (err) {
    $("errorBox").textContent = err?.message || "Could not compare these users.";
    $("errorBox").classList.remove("hidden");
  } finally {
    setLoading(false);
  }
}

$("cmpForm").addEventListener("submit", (e) => {
  e.preventDefault();
  compare($("cmpA").value, $("cmpB").value);
});

const data = await loadBadges();
badges = data.badges;
indexBadges();
$("footerSync").textContent = data.syncedAt ? `Updated ${formatDate(data.syncedAt)}` : "";
const params = new URLSearchParams(location.search);
if (params.get("a")) $("cmpA").value = params.get("a");
if (params.get("b")) $("cmpB").value = params.get("b");
if (params.get("a") && params.get("b")) compare(params.get("a"), params.get("b"));
else (params.get("a") ? $("cmpB") : $("cmpA")).focus();
fetchChannel().then(paintLiveIndicators).catch(() => {});
