// Looping meme clip for stream overlays. The 24/7 stream serves /memes/<KEY>.webm from the server
// (YouTube link in .env: MEME_OSRS=…, MEME_GTA6=…, MEME=… for all others). On the website there's no clip → stays hidden.
// URL option: ?meme=0 turns it off.

/** Fills `box` with the clip for `key` (falls back to DEFAULT); `onShow(visible)` lets the page make room. */
export function startMeme(box, key, onShow = () => {}) {
  if (!box || new URLSearchParams(location.search).get("meme") === "0") return;
  const video = document.createElement("video");
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
  box.replaceChildren(video);
  box.hidden = true;

  const keys = [...new Set([String(key || "").toUpperCase(), "DEFAULT"].filter(Boolean))];
  let i = 0;
  const show = (on) => {
    box.hidden = !on;
    onShow(on);
  };
  const load = () => {
    if (i >= keys.length) return show(false);
    video.src = `/memes/${encodeURIComponent(keys[i])}.webm?t=${Date.now()}`;
    video.load();
  };
  video.addEventListener("loadeddata", () => {
    show(true);
    video.play().catch(() => {
      video.muted = true; // stream without page sound: play silently instead of not at all
      video.play().catch(() => {});
    });
  });
  video.addEventListener("error", () => {
    i++;
    load();
  });
  // the stream tells us when a link in .env changed
  addEventListener("memeupdate", () => {
    i = 0;
    load();
  });
  load();
}
