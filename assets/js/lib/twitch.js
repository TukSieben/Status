// Shared helpers for the BadgeStatus Twitch channel (twitch.tv/badgestatus)
import { gql } from "./utils.js";

export const CHANNEL = "badgestatus";
export const CHANNEL_URL = `https://www.twitch.tv/${CHANNEL}`;

export async function fetchChannel() {
  try {
    const data = await gql(
      `query Channel($login: String!) {
        user(login: $login) {
          login displayName profileImageURL(width: 70)
          followers { totalCount }
          stream { id title viewersCount createdAt game { name displayName } }
        }
      }`,
      { login: CHANNEL }
    );
    const user = data?.user;
    if (!user) return null;
    const s = user.stream;
    return {
      live: Boolean(s?.id),
      displayName: user.displayName || CHANNEL,
      avatar: user.profileImageURL || "",
      followers: user.followers?.totalCount ?? null,
      title: s?.title || "",
      game: s?.game?.displayName || s?.game?.name || "",
      viewers: s?.viewersCount ?? 0,
      startedAt: s?.createdAt || null,
    };
  } catch {
    return null;
  }
}

/** True if the badge objective can be completed by watching the channel in its current category. */
export function earnableOnStream(badge, channel) {
  if (!channel?.live || !channel.game) return false;
  if (Array.isArray(badge.channels) && badge.channels.length && !badge.channels.some((c) => c.login === CHANNEL)) return false;
  if (/eligible\s+channels?/i.test(badge.objective || "")) return false;
  const text = `${badge.objective || ""}`.toLowerCase();
  if (!text.includes("watch")) return false;
  return text.includes(channel.game.toLowerCase());
}



/** Twitch embed player URL. Twitch only plays it on the listed parent domain(s). */
export function playerSrc() {
  const parents = new Set([location.hostname || "badgestatus.net", "badgestatus.net", "www.badgestatus.net"]);
  const params = new URLSearchParams({ channel: CHANNEL, muted: "true", autoplay: "true" });
  return `https://player.twitch.tv/?${params}&${[...parents].map((p) => `parent=${encodeURIComponent(p)}`).join("&")}`;
}

/** Updates every [data-live-indicator] element (nav link + footer) with live state. */
export function paintLiveIndicators(channel) {
  for (const node of document.querySelectorAll("[data-live-indicator]")) {
    node.classList.toggle("is-live", Boolean(channel?.live));
    const label = node.querySelector("[data-live-label]");
    if (label) label.textContent = channel?.live ? "Live" : "Stream";
  }
}
