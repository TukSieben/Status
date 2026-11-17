// Chat command logic for the BadgeStatus bot.
// Pure functions (no network) so they run the same in the Cloudflare Worker and in Node tests.

export const SITE = "https://badgestatus.net";
const MAX_MESSAGE = 480; // Twitch limit is 500 characters

/* ---------- helpers ---------- */

/** "Welcome 2 Miami" -> "welcome2miami", "DOOM: The Dark Ages" -> "doomthedarkages" */
export function commandKey(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function statusOf(b, now) {
  if (b.alwaysAvailable) return "permanent";
  const end = Date.parse(b.endAt || "");
  const start = Date.parse(b.startAt || "");
  if (Number.isNaN(end) || end <= now) return "ended";
  if (!Number.isNaN(start) && start > now) return "upcoming";
  return "active";
}

/** "Nov 14" in UTC */
function day(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Nov 18, 12:00 UTC" */
function dayTime(iso) {
  const d = new Date(iso);
  return `${day(iso)}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
}

/** "3d 4h", "5h 12m", "12m" */
export function rel(ms, now) {
  const diff = Math.max(0, ms - now);
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff / 3_600_000) % 24);
  const m = Math.floor((diff / 60_000) % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function clip(text) {
  return text.length <= MAX_MESSAGE ? text : `${text.slice(0, MAX_MESSAGE - 1)}…`;
}

/** Joins names until the message would get too long: "A, B, C (+4 more)" */
function listNames(names, budget) {
  const out = [];
  let used = 0;
  for (const n of names) {
    const add = (out.length ? 2 : 0) + n.length;
    if (used + add > budget) break;
    out.push(n);
    used += add;
  }
  const rest = names.length - out.length;
  return out.join(", ") + (rest > 0 ? ` (+${rest} more)` : "");
}

/* ---------- badge data ---------- */

/** Newest version per set, only badges that are available now or coming up. */
export function liveBadges(badges, now = Date.now()) {
  const bySet = new Map();
  for (const b of badges) {
    const prev = bySet.get(b.setID);
    if (!prev || Number(b.version) > Number(prev.version)) bySet.set(b.setID, b);
  }
  return [...bySet.values()]
    .map((b) => ({ ...b, status: statusOf(b, now) }))
    .filter((b) => b.status === "active" || b.status === "upcoming");
}

/**
 * Map of command key -> badge for every active / upcoming badge.
 * Each badge answers to its title ("!welcome2miami") and its set ID ("!welcome-2-miami" → same key).
 * Ended badges get no command — they are "deactivated" automatically.
 */
export function badgeCommands(badges, now = Date.now()) {
  const map = new Map();
  const live = liveBadges(badges, now).sort((a, b) => (a.status === "active" ? -1 : 1) - (b.status === "active" ? -1 : 1));
  for (const b of live) {
    for (const key of [commandKey(b.title), commandKey(b.setID)]) {
      if (key && !map.has(key)) map.set(key, b);
    }
  }
  return map;
}

/* ---------- responses ---------- */

export function badgeMessage(b, now = Date.now()) {
  const url = `${SITE}/badge/?id=${encodeURIComponent(b.setID)}`;
  const free = b.cost !== "paid";
  const objective = (b.objective || b.description || "Details not announced yet").replace(/\.$/, "");
  const paidNote = !free && /subscri|gift|sub\b/i.test(objective) ? " (Prime doesn't count)" : "";
  const dates = b.startAt && b.endAt ? `${day(b.startAt)} – ${day(b.endAt)} (UTC)` : "";

  if (b.status === "upcoming") {
    return clip(
      `${b.title} is coming! Starts ${dayTime(b.startAt)} (in ${rel(Date.parse(b.startAt), now)}). ` +
        `${free ? "Free: " : ""}${objective}${paidNote}. More details: ${url}`
    );
  }
  const ends = b.endAt ? ` Ends in ${rel(Date.parse(b.endAt), now)}.` : "";
  return clip(`${free ? "Free badge! " : ""}${objective}${paidNote}. ${dates}.${ends} More details: ${url}`);
}

function badgesMessage(badges, now) {
  const live = liveBadges(badges, now);
  const active = live.filter((b) => b.status === "active").sort((a, b) => Date.parse(a.endAt) - Date.parse(b.endAt));
  if (!active.length) return `No badges available right now. Upcoming: ${SITE}/badges/`;
  const free = active.filter((b) => b.cost !== "paid").length;
  const head = `${active.length} badges available (${free} free): `;
  const tail = ` · Type !<badge name> for details · ${SITE}/badges/`;
  return clip(head + listNames(active.map((b) => b.title), MAX_MESSAGE - head.length - tail.length) + tail);
}

function nextMessage(badges, now) {
  const upcoming = liveBadges(badges, now)
    .filter((b) => b.status === "upcoming")
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  if (!upcoming.length) return `No upcoming badges announced yet. ${SITE}`;
  const first = upcoming[0];
  const together = upcoming.filter((b) => b.startAt === first.startAt);
  const event = (first.eventName || first.title).replace(/\s*\((subscribe|sub|watch)\)$/i, "");
  const head = `Next drop: ${event} in ${rel(Date.parse(first.startAt), now)} (${dayTime(first.startAt)}) · `;
  const tail = ` · ${SITE}`;
  return clip(head + listNames(together.map((b) => b.title), MAX_MESSAGE - head.length - tail.length) + tail);
}

function endingMessage(badges, now) {
  const active = liveBadges(badges, now)
    .filter((b) => b.status === "active")
    .sort((a, b) => Date.parse(a.endAt) - Date.parse(b.endAt))
    .slice(0, 5);
  if (!active.length) return `No badges available right now. ${SITE}`;
  return clip(`Ending soon: ${active.map((b) => `${b.title} (${rel(Date.parse(b.endAt), now)})`).join(", ")} · ${SITE}`);
}

export const HELP =
  `BadgeStatus commands: !badges (available now), !next (next drop), !ending, !missing <user>, ` +
  `and !<badge name> for any active badge (e.g. !gallica). Full tracker: ${SITE}`;

/**
 * Handles one chat message. Returns
 *   { reply: string }                      → send this
 *   { missing: login }                     → caller looks up the user's badges, then calls missingMessage()
 *   null                                   → not a command for us
 */
export function handleMessage(text, badges, now = Date.now()) {
  const m = String(text || "").trim().match(/^!(\S+)(?:\s+(.*))?$/);
  if (!m) return null;
  const cmd = commandKey(m[1]);
  const arg = (m[2] || "").trim();

  switch (cmd) {
    case "badgestatus":
    case "badgecommands":
    case "badgehelp":
      return { reply: HELP };
    case "badges":
    case "activebadges":
      return { reply: badgesMessage(badges, now) };
    case "next":
    case "nextbadge":
    case "nextdrop":
      return { reply: nextMessage(badges, now) };
    case "ending":
    case "endingsoon":
      return { reply: endingMessage(badges, now) };
    case "missing":
    case "mybadges": {
      const login = arg.replace(/^@/, "").replace(/^.*twitch\.tv\//, "").split(/\s/)[0].toLowerCase();
      return { missing: /^[a-z0-9_]{2,25}$/.test(login) ? login : null };
    }
    case "badge": {
      // "!badge gallica" works too
      const b = badgeCommands(badges, now).get(commandKey(arg));
      return b ? { reply: badgeMessage(b, now) } : arg ? null : { reply: HELP };
    }
    default: {
      const b = badgeCommands(badges, now).get(cmd);
      return b ? { reply: badgeMessage(b, now) } : null;
    }
  }
}

/** Reply for !missing once the user's earned badges are known. */
export function missingMessage(login, displayName, earned, badges, now = Date.now()) {
  const owned = new Set(earned.map((e) => e.setID));
  const active = liveBadges(badges, now).filter((b) => b.status === "active");
  const missing = active.filter((b) => !owned.has(b.setID)).sort((a, b) => Date.parse(a.endAt) - Date.parse(b.endAt));
  const link = `${SITE}/badges/?user=${encodeURIComponent(login)}`;
  if (!missing.length) return clip(`${displayName} has all ${active.length} available badges! ${link}`);
  const head = `${displayName} is missing ${missing.length} of ${active.length} available badges: `;
  const tail = ` · ${link}`;
  return clip(head + listNames(missing.map((b) => b.title), MAX_MESSAGE - head.length - tail.length) + tail);
}
