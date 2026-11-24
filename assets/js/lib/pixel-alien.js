// Pixel alien mascot for stream overlays: bored while nothing happens (2 tiny repaints a second, cheap on the server),
// jumps with pixel sparks + a speech bubble on follows and badge commands. URL option: ?alien=0 hides it.
// It levels up with the channel's followers (sunglasses 500, cape 750, crown 1000) and wears a Santa hat in December.
// Test options: ?followers=800 · ?winter=1 / ?winter=0
import { fetchChannel } from "./twitch.js";
const IMG = "/assets/img/aliens/";
export const LEVELS = [[500, "sunglasses"], [750, "cape"], [1000, "crown"]];
export const isWinter = (d = new Date()) => {
  const p = new URLSearchParams(location.search).get("winter");
  return p === "1" ? true : p === "0" ? false : d.getMonth() === 11;
};
const CSS = `
.px-alien { position: absolute; z-index: 6; pointer-events: none; }
.px-alien-body { position: absolute; inset: 0; animation: px-bob 1s steps(1) infinite; }
.px-alien-body img { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; }
.px-alien-body img[hidden] { display: none; }
.px-acc-sunglasses { transition: transform .2s steps(2); }
.px-alien.is-happy .px-acc-sunglasses { transform: translateY(-19%); } /* glasses up on the forehead while cheering */
@keyframes px-bob { 0% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
.px-alien.is-cheer .px-alien-body { animation: px-jump .45s cubic-bezier(.3, .7, .4, 1) 3; }
.px-alien.is-hop .px-alien-body { animation: px-jump .32s cubic-bezier(.3, .7, .4, 1) 2; }
@keyframes px-jump { 0%, 100% { transform: translateY(0); } 45% { transform: translateY(-24px); } }
.px-spark { position: absolute; width: 9px; height: 9px; background: #e6ff5c; left: 50%; top: 45%; opacity: 0; }
.px-alien.is-cheer .px-spark { animation: px-spark 1.1s ease-out 1; }
@keyframes px-spark { 0% { opacity: 1; transform: translate(-50%, -50%) rotate(var(--a)) translateX(30px); }
  100% { opacity: 0; transform: translate(-50%, -50%) rotate(calc(var(--a) + 70deg)) translateX(78px); } }
.px-bubble { position: absolute; right: -6px; top: calc(100% + 22px); min-width: 220px; padding: 12px 20px 13px; border-radius: 13px;
  background: var(--px-bg, rgba(18, 14, 10, .94)); border: 3px solid var(--px-accent, #e8c26a); color: var(--px-text, #f3ead8); font: 800 22px/1.25 var(--sans, Inter, sans-serif);
  white-space: nowrap; opacity: 0; transform: translateY(-6px); transition: opacity .25s, transform .25s; }
.px-bubble::before { content: ""; position: absolute; right: 40px; top: -17px; border: 8px solid transparent; border-bottom: 9px solid var(--px-accent, #e8c26a); }
.px-bubble small { display: block; font-size: 18px; font-weight: 600; color: var(--px-accent, #e8c26a); }
.px-alien.is-talking .px-bubble { opacity: 1; transform: none; }
/* bubble to the left of the alien (OSRS: the area below is covered by the meme video, which ffmpeg draws on top) */
.px-alien.is-left .px-bubble { right: calc(100% + 16px); top: 8px; min-width: 0; max-width: 236px; overflow: hidden; text-overflow: ellipsis; transform: translateX(6px); }
.px-alien.is-left .px-bubble small { overflow: hidden; text-overflow: ellipsis; }
.px-alien.is-left .px-bubble::before { display: none; }
.px-alien.is-left::after { content: ""; position: absolute; right: calc(100% + 1px); top: 34px; border: 8px solid transparent; border-left: 10px solid var(--px-accent, #e8c26a); opacity: 0; transition: opacity .25s; }
.px-alien.is-left.is-talking::after { opacity: 1; }
.px-alien.is-left.is-talking .px-bubble { transform: none; }
/* bubble to the right, below (GTA: keeps clear of the meme video on the left) */
.px-alien.is-right .px-bubble { right: auto; left: 52px; }
.px-alien.is-right .px-bubble::before { right: auto; left: 10px; }`;

/** box: { left, top, size } in stage pixels. Returns { cheer(lines), hop(lines) } */
export function startPixelAlien(host, { left, top, size = 96, accent, bg, text, bubble: side = "below" } = {}) {
  if (!host || new URLSearchParams(location.search).get("alien") === "0") return null;
  if (!document.getElementById("pxAlienCss")) {
    const style = document.createElement("style");
    style.id = "pxAlienCss";
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  for (const n of ["bored", "bored-blink", "happy", "acc-sunglasses", "acc-cape", "acc-crown", "acc-santa"]) new Image().src = `${IMG}${n}.png`; // preload

  const root = document.createElement("div");
  root.className = side === "left" ? "px-alien is-left" : side === "right" ? "px-alien is-right" : "px-alien";
  Object.assign(root.style, { left: `${left}px`, top: `${top}px`, width: `${size}px`, height: `${size}px` });
  if (accent) root.style.setProperty("--px-accent", accent);
  if (bg) root.style.setProperty("--px-bg", bg);
  if (text) root.style.setProperty("--px-text", text);
  const body = document.createElement("div");
  body.className = "px-alien-body";
  const layer = (name) => {
    const im = document.createElement("img");
    im.alt = "";
    im.className = `px-acc-${name}`;
    im.src = `${IMG}acc-${name}.png`;
    im.hidden = true;
    return im;
  };
  const sprite = document.createElement("img");
  sprite.className = "px-alien-sprite";
  sprite.alt = "";
  sprite.src = `${IMG}bored.png`;
  const acc = { cape: layer("cape"), sunglasses: layer("sunglasses"), crown: layer("crown"), santa: layer("santa") };
  body.append(acc.cape, sprite, acc.sunglasses, acc.crown, acc.santa);
  const bubble = document.createElement("div");
  bubble.className = "px-bubble";
  root.append(body, bubble);
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
    root.classList.add("is-happy");
    bubble.replaceChildren(lines[0]);
    if (lines[1]) bubble.appendChild(Object.assign(document.createElement("small"), { textContent: lines[1] }));
    root.classList.remove("is-cheer", "is-hop");
    void root.offsetWidth;
    root.classList.add(kind, "is-talking");
    setTimeout(() => root.classList.remove("is-talking"), 2600);
    setTimeout(() => {
      root.classList.remove(kind, "is-happy");
      sprite.src = `${IMG}bored.png`;
      busy = false;
      if (queue.length) setTimeout(() => react(...queue.shift()), 400);
    }, 3000);
  }
  /* level-ups from the follower count (checked every 5 min) + Santa hat in December */
  const forced = Number(new URLSearchParams(location.search).get("followers"));
  let shownLevel = null;
  function dress(followers) {
    const have = new Set(LEVELS.filter(([n]) => followers >= n).map(([, item]) => item));
    const winter = isWinter();
    acc.sunglasses.hidden = !have.has("sunglasses");
    acc.cape.hidden = !have.has("cape");
    acc.crown.hidden = !have.has("crown") || winter; // the hat wins in December
    acc.santa.hidden = !winter;
    const level = have.size;
    if (shownLevel !== null && level > shownLevel) {
      const [n] = LEVELS[level - 1];
      react("is-cheer", ["Level up!", `${n.toLocaleString("en-US")} followers`]);
    }
    shownLevel = level;
  }
  async function refresh() {
    if (forced > 0) return dress(forced);
    const ch = await fetchChannel().catch(() => null);
    if (Number.isFinite(ch?.followers)) dress(ch.followers);
    else {
      // no count right now: keep the accessories, only follow the calendar for the hat
      acc.santa.hidden = !isWinter();
      if (isWinter()) acc.crown.hidden = true;
    }
  }
  refresh();
  setInterval(refresh, 5 * 60_000);

  return { cheer: (lines) => react("is-cheer", lines), hop: (lines) => react("is-hop", lines) };
}
