// Site-wide animated background (purple gradient waves behind all content).
import { mountGradientWaves } from "./gradient-waves.js";

const host = document.getElementById("bgWaves");
if (host) {
  mountGradientWaves(host, {
    horizonColor: "#3a1699",
    waveColor: "#9146ff",
    crestColor: "#c4b5fd",
    speed: 0.3,
    amplitude: 2.5,
    relief: 1,
    lightAngle: 120,
    brightness: 1.1,
    opacity: 0.95,
    grain: 0.15,
    quality: "low", // full-screen background: keep the GPU cost low
    dpr: 1,
    mouseInteraction: true,
    parallaxStrength: 0.4,
    swellOnClick: true,
  });
}
