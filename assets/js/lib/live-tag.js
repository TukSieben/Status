// Faint "THIS IS LIVE · NOT A VOD" strip along the bottom of a stream overlay, with the current time in the middle.
// The page gives it the last grid row (stage class "has-livemark"). URL option: ?livetag=0 hides it.
const CSS = `
.live-mark { grid-column: 1 / -1; align-self: center; display: flex; align-items: center; justify-content: space-between;
  font-family: var(--sans, Inter, sans-serif); font-size: 38px; font-weight: 900; letter-spacing: .2em; line-height: 1;
  text-transform: uppercase; color: #fff; white-space: nowrap; pointer-events: none; position: relative; z-index: 3;
  text-shadow: 0 3px 0 rgba(0, 0, 0, .75), 0 0 2px rgba(0, 0, 0, .9), 0 0 20px rgba(0, 0, 0, .6); }
.live-mark-time { display: inline-flex; align-items: center; gap: 12px; font-size: 26px; letter-spacing: .14em; font-variant-numeric: tabular-nums; }
.live-mark-time i { width: 12px; height: 12px; border-radius: 50%; background: #ef4444; opacity: .9; }`;

export function startLiveTag(stage) {
  if (!stage || new URLSearchParams(location.search).get("livetag") === "0") return;
  if (!document.getElementById("liveTagCss")) {
    const style = document.createElement("style");
    style.id = "liveTagCss";
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  const bar = document.createElement("div");
  bar.className = "live-mark";
  const left = document.createElement("span");
  left.textContent = "This is live";
  const mid = document.createElement("span");
  mid.className = "live-mark-time";
  const time = document.createElement("b");
  mid.append(document.createElement("i"), time);
  const right = document.createElement("span");
  right.textContent = "Not a VOD";
  bar.append(left, mid, right);
  stage.appendChild(bar);
  stage.classList.add("has-livemark");
  const tick = () => {
    time.textContent = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  };
  tick();
  setInterval(tick, 15_000);
}
