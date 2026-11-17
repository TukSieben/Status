// Site-wide background (purple "dark veil" behind all content).
//
// Performance: the veil is drawn once (plus its short fade-in) and then stays still.
// With flow 0 the animation was barely visible but re-rendered a full-screen shader every
// frame, which kept the GPU busy permanently. paused + no mouse interaction stops the loop;
// dpr 1 and a lower field quality keep the one-off render cheap. It re-renders only on resize.
import { mountDarkVeil } from "./dark-veil.js";

const host = document.getElementById("bgWaves");
if (host) {
  mountDarkVeil(host, {
    color: "#6b12ff",
    flow: 0,
    glow: 0.7,
    grain: 0.07,
    paused: true,
    mouseInteraction: false,
    quality: 0.4,
    dpr: 1,
  });
}
