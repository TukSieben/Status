// Small "LIVE — not a VOD" tag with the current time, so viewers can see the stream is running right now.
const CSS = `
.live-tag { display: inline-flex; align-items: center; gap: 9px; margin-left: 18px; padding: 5px 12px 5px 10px; border-radius: 999px;
  vertical-align: middle; font-family: var(--sans, Inter, sans-serif); font-size: 15px; font-weight: 800; letter-spacing: .12em;
  text-transform: uppercase; color: #fff; background: rgba(0, 0, 0, .42); border: 1px solid rgba(255, 255, 255, .22); white-space: nowrap; }
.live-tag i { width: 9px; height: 9px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 0 3px rgba(239, 68, 68, .25); }
.live-tag b { font-weight: 800; color: rgba(255, 255, 255, .72); font-variant-numeric: tabular-nums; }
.live-tag.is-block { margin: 8px 0 0; }`;

export function startLiveTag(host, { block = false } = {}) {
  if (!host || new URLSearchParams(location.search).get("livetag") === "0") return;
  if (!document.getElementById("liveTagCss")) {
    const style = document.createElement("style");
    style.id = "liveTagCss";
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  const tag = document.createElement("span");
  tag.className = `live-tag${block ? " is-block" : ""}`;
  const time = document.createElement("b");
  tag.append(document.createElement("i"), "Live — not a VOD ·", time);
  host.appendChild(tag);
  const tick = () => {
    time.textContent = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  };
  tick();
  setInterval(tick, 15_000);
}
