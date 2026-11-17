// Shared helpers for the BadgeStatus Twitch channel (twitch.tv/badgestatus)
export const CHANNEL = "badgestatus";
export const CHANNEL_URL = `https://www.twitch.tv/${CHANNEL}`;

const GQL_URL = "https://gql.twitch.tv/gql";
const TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

export async function fetchChannel() {
  try {
    const res = await fetch(GQL_URL, {
      method: "POST",
      headers: { "Client-ID": TWITCH_CLIENT_ID, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query Channel($login: String!) {
          user(login: $login) {
            login displayName profileImageURL(width: 70)
            followers { totalCount }
            stream { id title viewersCount createdAt game { name displayName } }
          }
        }`,
        variables: { login: CHANNEL },
      }),
    });
    if (!res.ok) return null;
    const user = (await res.json())?.data?.user;
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
  const text = `${badge.objective || ""}`.toLowerCase();
  if (!text.includes("watch")) return false;
  return text.includes(channel.game.toLowerCase());
}

function parentParams() {
  const parents = new Set([location.hostname || "badgestatus.net", "badgestatus.net", "www.badgestatus.net"]);
  return [...parents].map((p) => `parent=${encodeURIComponent(p)}`).join("&");
}

export function playerSrc() {
  const params = new URLSearchParams({ channel: CHANNEL, muted: "true", autoplay: "true" });
  return `https://player.twitch.tv/?${params}&${parentParams()}`;
}

export function chatSrc() {
  return `https://www.twitch.tv/embed/${CHANNEL}/chat?darkpopout&${parentParams()}`;
}

/** Updates every [data-live-indicator] element (nav link + footer) with live state. */
export function paintLiveIndicators(channel) {
  for (const node of document.querySelectorAll("[data-live-indicator]")) {
    node.classList.toggle("is-live", Boolean(channel?.live));
    const label = node.querySelector("[data-live-label]");
    if (label) label.textContent = channel?.live ? "Live" : "Stream";
  }
}
