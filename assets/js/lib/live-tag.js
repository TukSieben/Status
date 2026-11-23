// Small "LIVE — not a VOD" tag with the current time, so viewers can see the stream is running right now.
const CSS = `
.live-tag { display: inline-flex; align-items: center; gap: 14px; margin-left: 24px; padding: 9px 22px 9px 18px; border-radius: 999px;
  vertical-align: middle; font-family: var(--sans, Inter, sans-serif); font-size: var(--live-size, 28px); font-weight: 900; letter-spacing: .08em;
  line-height: 1.1; text-transform: uppercase; color: #fff; background: #d81e2c; border: 2px solid rgba(255, 255, 255, .35);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .35); white-space: nowrap; }
.live-tag i { width: .55em; height: .55em; border-radius: 50%; background: #fff; box-shadow: 0 0 0 .18em rgba(255, 255, 255, .3); }
.live-tag b { font-weight: 800; color: rgba(255, 255, 255, .85); font-variant-numeric: tabular-nums; }`;

/** size: font size in px (default 28) */
export function startLiveTag(host, { size = 28, before = null } = {}) {
  if (!host || new URLSearchParams(location.search).get("livetag") === "0") return;
  if (!document.getElementById("liveTagCss")) {
    const style = document.createElement("style");
    style.id = "liveTagCss";
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  const tag = document.createElement("span");
  tag.className = "live-tag";
  tag.style.setProperty("--live-size", `${size}px`);
  const time = document.createElement("b");
  tag.append(document.createElement("i"), "Live — not a VOD ·", time);
  if (before) host.insertBefore(tag, before);
  else host.appendChild(tag);
  const tick = () => {
    time.textContent = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  };
  tick();
  setInterval(tick, 15_000);
}
