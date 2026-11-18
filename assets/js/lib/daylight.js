// Day & night look for stream pages: colors follow the time of day (default Europe/Berlin).
// Frames are key moments ({ h: hour, v: { name: "#hex" | number } }); values blend smoothly in between.
// Updates every 5 minutes — tiny steps nobody notices, and no running animation (cheap for server streams).
// URL options: ?daylight=0 (off) · ?tz=America/New_York · ?hour=14 (preview a time)

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
const rgbToHex = (rgb) => "#" + rgb.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");

function blend(a, b, t) {
  const out = {};
  for (const key of Object.keys(a)) {
    const x = a[key];
    const y = b[key] ?? x;
    if (typeof x === "number") out[key] = x + (y - x) * t;
    else {
      const p = hexToRgb(x);
      const q = hexToRgb(y);
      out[key] = rgbToHex(p.map((v, i) => v + (q[i] - v) * t));
    }
  }
  return out;
}

export function sampleDaylight(frames, hour) {
  const list = [...frames].sort((a, b) => a.h - b.h);
  const loop = [...list, { ...list[0], h: list[0].h + 24 }];
  const h = ((hour % 24) + 24) % 24 < list[0].h ? (((hour % 24) + 24) % 24) + 24 : ((hour % 24) + 24) % 24;
  for (let i = 0; i < loop.length - 1; i++) {
    const a = loop[i];
    const b = loop[i + 1];
    if (h >= a.h && h < b.h) {
      const t = (h - a.h) / (b.h - a.h);
      return blend(a.v, b.v, t * t * (3 - 2 * t)); // ease in/out
    }
  }
  return { ...list[0].v };
}

export function startDaylight(frames, apply) {
  const params = new URLSearchParams(location.search);
  if (params.get("daylight") === "0") return;
  const tz = params.get("tz") || "Europe/Berlin";
  const fixed = params.has("hour") ? Number(params.get("hour")) : null;
  const hourNow = () => {
    if (fixed !== null && !Number.isNaN(fixed)) return fixed;
    try {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date());
      return Number(parts.find((p) => p.type === "hour").value) + Number(parts.find((p) => p.type === "minute").value) / 60;
    } catch {
      const d = new Date();
      return d.getHours() + d.getMinutes() / 60;
    }
  };
  const tick = () => apply(sampleDaylight(frames, hourNow()));
  tick();
  setInterval(tick, 5 * 60_000);
}

/** Sets each value as a CSS variable (--name) on an element */
export function setVars(node, values) {
  for (const [k, v] of Object.entries(values)) node.style.setProperty(`--${k}`, String(v));
}
