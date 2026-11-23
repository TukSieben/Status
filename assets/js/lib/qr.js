// QR code as an SVG element (no network, drawn in the page).
import qrcode from "../vendor/qrcode.js?v=1";

/** dark modules on a light tile; `quiet` = empty border in modules */
export function qrSvg(text, { dark = "#16110c", light = "#f3ead8", quiet = 2 } = {}) {
  const qr = qrcode(0, "L"); // low correction = fewer, bigger squares (reads better on a stream)
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + quiet * 2;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  }
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  const bg = document.createElementNS(ns, "rect");
  bg.setAttribute("width", size);
  bg.setAttribute("height", size);
  bg.setAttribute("fill", light);
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", dark);
  svg.append(bg, path);
  return svg;
}
