// Pixel alien mascot for stream overlays: bored while nothing happens (2 tiny repaints a second, cheap on the server),
// jumps with pixel sparks + a speech bubble on follows and badge commands. URL option: ?alien=0 hides it.
const IMG = "/assets/img/aliens/";
const CSS = `
.px-alien { position: absolute; z-index: 6; pointer-events: none; }
.px-alien-sprite { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; animation: px-bob 1s steps(1) infinite; }
@keyframes px-bob { 0% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
.px-alien.is-cheer .px-alien-sprite { animation: px-jump .45s cubic-bezier(.3, .7, .4, 1) 3; }
.px-alien.is-hop .px-alien-sprite { animation: px-jump .32s cubic-bezier(.3, .7, .4, 1) 2; }
@keyframes px-jump { 0%, 100% { transform: translateY(0); } 45% { transform: translateY(-24px); } }
.px-spark { position: absolute; width: 9px; height: 9px; background: #e6ff5c; left: 50%; top: 45%; opacity: 0; }
.px-alien.is-cheer .px-spark { animation: px-spark 1.1s ease-out 1; }
@keyframes px-spark { 0% { opacity: 1; transform: translate(-50%, -50%) rotate(var(--a)) translateX(30px); }
  100% { opacity: 0; transform: translate(-50%, -50%) rotate(calc(var(--a) + 70deg)) translateX(78px); } }
.px-bubble { position: absolute; right: -6px; top: calc(100% + 22px); min-width: 220px; padding: 12px 20px 13px; border-radius: 13px;
  background: rgba(18, 14, 10, .94); border: 3px solid #e8c26a; color: #f3ead8; font: 800 22px/1.25 var(--sans, Inter, sans-serif);
  white-space: nowrap; opacity: 0; transform: translateY(-6px); transition: opacity .25s, transform .25s; }
.px-bubble::before { content: ""; position: absolute; right: 40px; top: -17px; border: 8px solid transparent; border-bottom: 9px solid #e8c26a; }
.px-bubble small { display: block; font-size: 18px; font-weight: 600; color: #e8c26a; }
.px-alien.is-talking .px-bubble { opacity: 1; transform: none; }`;

/** box: { left, top, size } in stage pixels. Returns { cheer(lines), hop(lines) } */
export function startPixelAlien(host, { left, top, size = 96 } = {}) {
  if (!host || new URLSearchParams(location.search).get("alien") === "0") return null;
  if (!document.getElementById("pxAlienCss")) {
    const style = document.createElement("style");
    style.id = "pxAlienCss";
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  for (const n of ["bored", "bored-blink", "happy"]) new Image().src = `${IMG}${n}.png`; // preload

  const root = document.createElement("div");
  root.className = "px-alien";
  Object.assign(root.style, { left: `${left}px`, top: `${top}px`, width: `${size}px`, height: `${size}px` });
  const sprite = document.createElement("img");
  sprite.className = "px-alien-sprite";
  sprite.alt = "";
  sprite.src = `${IMG}bored.png`;
  const bubble = document.createElement("div");
  bubble.className = "px-bubble";
  root.append(sprite, bubble);
  for (let i = 0; i < 6; i++) {
    const s = document.createElement("span");
    s.className = "px-spark";
    s.style.setProperty("--a", `${i * 60}deg`);
    root.appendChild(s);
  }
  host.appendChild(root);

  let busy = false;
  const queue = [];
  // blink every few seconds while bored
  setInterval(() => {
    if (busy) return;
    sprite.src = `${IMG}bored-blink.png`;
    setTimeout(() => { if (!busy) sprite.src = `${IMG}bored.png`; }, 160);
  }, 3400);

  function react(kind, lines) {
    if (busy) {
      if (queue.length < 2) queue.push([kind, lines]);
      return;
    }
    busy = true;
    sprite.src = `${IMG}happy.png`;
    bubble.replaceChildren(lines[0]);
    if (lines[1]) bubble.appendChild(Object.assign(document.createElement("small"), { textContent: lines[1] }));
    root.classList.remove("is-cheer", "is-hop");
    void root.offsetWidth;
    root.classList.add(kind, "is-talking");
    setTimeout(() => root.classList.remove("is-talking"), 2600);
    setTimeout(() => {
      root.classList.remove(kind);
      sprite.src = `${IMG}bored.png`;
      busy = false;
      if (queue.length) setTimeout(() => react(...queue.shift()), 400);
    }, 3000);
  }
  return { cheer: (lines) => react("is-cheer", lines), hop: (lines) => react("is-hop", lines) };
}
