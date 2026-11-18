// "Get it right here" box: our live stream embedded next to badges it can earn.
import { el } from "./utils.js";
import { CHANNEL_URL, playerSrc } from "./twitch.js";

/**
 * Shows (or removes) the live box right after `anchor`.
 * The player is created once and never reloaded while it stays visible.
 */
export function syncLiveEmbed(anchor, show, { title, text } = {}) {
  let box = document.getElementById("liveEmbed");
  if (!show) {
    box?.remove();
    return;
  }
  if (!box) {
    box = el("section", "live-embed");
    box.id = "liveEmbed";

    const head = el("div", "live-embed-head");
    const info = el("div", "live-embed-info");
    const tag = el("span", "live-embed-tag");
    tag.append(el("span", "stream-dot"), "Live now");
    info.append(tag, el("h2", "live-embed-title"), el("p", "live-embed-text"));
    const open = el("a", "btn-white live-embed-open", "Open on Twitch ↗");
    open.href = CHANNEL_URL;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    head.append(info, open);

    const frame = el("div", "live-embed-frame");
    const iframe = document.createElement("iframe");
    iframe.src = playerSrc();
    iframe.title = "BadgeStatus live stream";
    iframe.allowFullscreen = true;
    iframe.setAttribute("allow", "autoplay; fullscreen");
    frame.appendChild(iframe);

    const note = el("p", "live-embed-note", "Watch time only counts while you’re logged in to Twitch. If it doesn’t track here, open the stream on Twitch.");
    box.append(head, frame, note);
    anchor.after(box);
  }
  box.querySelector(".live-embed-title").textContent = title || "Get this badge right here";
  box.querySelector(".live-embed-text").textContent = text || "";
}
