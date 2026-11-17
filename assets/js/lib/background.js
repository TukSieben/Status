// Site-wide animated background (purple "dark veil" behind all content).
import { mountDarkVeil } from "./dark-veil.js";

const host = document.getElementById("bgWaves");
if (host) {
  mountDarkVeil(host, {
    color: "#6b12ff",
    flow: 0,
    glow: 0.7,
    grain: 0.07,
    quality: 0.5, // full-screen background: render the field at half resolution
    mouseInteraction: true,
  });
}
