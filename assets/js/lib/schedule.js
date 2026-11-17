// Draggable timeline ("Schedule") of active + upcoming badge events.
import { el, img, badgeHref } from "./utils.js";
const DAY_MS = 86_400_000;
const DAY_PX = 72;
const MIN_DAYS = 21;
const MAX_DAYS = 90;

function startOfLocalDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function shortRel(ms) {
  const diff = Math.max(0, ms - Date.now());
  const d = Math.floor(diff / DAY_MS);
  const h = Math.floor((diff / 3_600_000) % 24);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((diff / 60_000) % 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function fmt(ms) {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" });
}

/** Groups badges into events (by eventName, falling back to the badge title). */
export function buildEvents(badges, now = Date.now()) {
  const groups = new Map();
  const seen = new Set();
  for (const b of badges) {
    if (seen.has(b.setID)) continue;
    const start = Date.parse(b.startAt || "");
    const end = Date.parse(b.endAt || "");
    if (Number.isNaN(start) || Number.isNaN(end) || end <= now) continue;
    seen.add(b.setID);
    const key = (b.eventName || b.title || b.setID).trim();
    let g = groups.get(key);
    if (!g) {
      g = { name: key, start, end, badges: [], paid: 0, free: 0 };
      groups.set(key, g);
    }
    g.start = Math.min(g.start, start);
    g.end = Math.max(g.end, end);
    g.badges.push(b);
    if (b.cost === "paid") g.paid++;
    else g.free++;
  }
  const list = [...groups.values()];
  for (const g of list) g.upcoming = g.start > now;
  list.sort((a, b) => {
    if (a.upcoming !== b.upcoming) return a.upcoming ? 1 : -1;
    return a.upcoming ? a.start - b.start || a.end - b.end : a.end - b.end || a.start - b.start;
  });
  return list;
}

function enableDragScroll(scroller) {
  let down = false;
  let startX = 0;
  let startLeft = 0;
  let moved = false;

  scroller.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    down = true;
    moved = false;
    startX = e.clientX;
    startLeft = scroller.scrollLeft;
  });
  const onMove = (e) => {
    if (!down) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) > 3) {
      moved = true;
      // Only now treat it as a drag (this disables clicks on bars/icons)
      scroller.classList.add("is-dragging");
    }
    scroller.scrollLeft = startLeft - dx;
  };
  const onUp = () => {
    if (!down) return;
    down = false;
    scroller.classList.remove("is-dragging");
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  // Swallow the click that ends a drag so bars don't navigate
  scroller.addEventListener(
    "click",
    (e) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    },
    true
  );
  // Vertical wheel scrolls horizontally when hovering with shift-less wheel on a horizontal-only area
  scroller.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || !e.shiftKey) return;
      scroller.scrollLeft += e.deltaY;
      e.preventDefault();
    },
    { passive: false }
  );
  return () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
}

/**
 * Renders the schedule into `root`.
 * Clicking a badge icon opens that badge; clicking elsewhere on the bar opens
 * options.href(event) (defaults to the event's first badge).
 */
export function renderSchedule(root, badges, options = {}) {
  const now = Date.now();
  const events = buildEvents(badges, now);
  const prevScroll = root.querySelector(".sched-scroll")?.scrollLeft; // keep position on auto-refresh
  root._schedCleanup?.();
  root.replaceChildren();

  if (events.length === 0) {
    root.appendChild(el("div", "sched-empty", "No active or upcoming badge events."));
    return;
  }

  const rangeStart = startOfLocalDay(now - DAY_MS);
  const lastEnd = Math.max(...events.map((e) => e.end));
  const days = Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.ceil((lastEnd - rangeStart) / DAY_MS) + 1));
  const rangeEnd = rangeStart + days * DAY_MS;
  const width = days * DAY_PX;
  const x = (ms) => ((Math.min(Math.max(ms, rangeStart), rangeEnd) - rangeStart) / DAY_MS) * DAY_PX;

  // Legend
  const legend = el("div", "sched-legend");
  const lg = (cls, text) => {
    const item = el("span", "sched-legend-item");
    item.append(el("span", `sched-swatch ${cls}`), document.createTextNode(text));
    return item;
  };
  legend.append(lg("sw-now", "Current time"), lg("sw-active", "Available"), lg("sw-upcoming", "Upcoming"));
  const hint = el("span", "sched-hint", "Drag →");
  legend.appendChild(hint);

  const scroller = el("div", "sched-scroll");
  const inner = el("div", "sched-inner");
  inner.style.width = `${width}px`;

  // Day columns + header
  const header = el("div", "sched-header");
  const cols = el("div", "sched-cols");
  for (let i = 0; i < days; i++) {
    const dayMs = rangeStart + i * DAY_MS;
    const d = new Date(dayMs);
    const isToday = startOfLocalDay(now) === startOfLocalDay(dayMs);
    const label = d.toLocaleString("en-US", { month: "short", day: "numeric" }).toUpperCase();
    const cell = el("div", `sched-day${i % 2 ? " is-alt" : ""}${isToday ? " is-today" : ""}`, label);
    cell.style.left = `${i * DAY_PX}px`;
    cell.style.width = `${DAY_PX}px`;
    header.appendChild(cell);

    const col = el("div", `sched-col${i % 2 ? " is-alt" : ""}`);
    col.style.left = `${i * DAY_PX}px`;
    col.style.width = `${DAY_PX}px`;
    cols.appendChild(col);
  }

  // Rows
  const rows = el("div", "sched-rows");
  for (const ev of events) {
    const row = el("div", "sched-row");
    const left = x(ev.start);
    const barW = Math.max(6, x(ev.end) - left);
    const clippedLeft = ev.start < rangeStart;

    // A <div> (not <a>) so each badge icon inside can be its own link
    const bar = el("div", `sched-bar ${ev.upcoming ? "is-upcoming" : "is-active"}${clippedLeft ? " is-clipped" : ""}`);
    const barHref = options.href ? options.href(ev) : badgeHref(ev.badges[0]);
    bar.setAttribute("role", "link");
    bar.tabIndex = 0;
    bar.style.left = `${left}px`;
    bar.style.width = `${barW}px`;
    bar.title = `${ev.name}\n${fmt(ev.start)} → ${fmt(ev.end)}\n${ev.badges.length} badge${ev.badges.length === 1 ? "" : "s"} · ${ev.free} free · ${ev.paid} paid`;
    bar.addEventListener("click", (e) => {
      if (e.target.closest("a")) return; // icon link handles itself
      if (e.ctrlKey || e.metaKey) window.open(barHref, "_blank");
      else location.href = barHref;
    });
    bar.addEventListener("keydown", (e) => {
      if (e.key === "Enter") location.href = barHref;
    });

    const label = el("span", "sched-label");
    const icons = el("span", "sched-icons");
    for (const b of ev.badges.slice(0, 6)) {
      const link = el("a", "sched-icon");
      link.href = badgeHref(b);
      link.title = b.title;
      const i = el("img");
      i.src = img(b, 2);
      i.alt = b.title;
      i.loading = "lazy";
      link.appendChild(i);
      icons.appendChild(link);
    }
    label.append(icons, el("span", "sched-name", ev.name));

    const rel = el("span", "sched-rel", ev.upcoming ? `starts in ${shortRel(ev.start)}` : `ends in ${shortRel(ev.end)}`);
    // Rough width of icons + name; if the bar can't fit label + countdown, put the countdown outside
    const labelW = 16 + Math.min(ev.badges.length, 6) * 23 + ev.name.length * 7;
    if (barW < labelW + 110 + (clippedLeft ? DAY_PX * 1.3 : 0)) {
      bar.classList.add("is-narrow");
      rel.style.left = `${Math.max(barW, labelW) + 10}px`;
    }
    bar.append(label, rel);
    row.appendChild(bar);
    rows.appendChild(row);
  }

  // Now line
  const nowLine = el("div", "sched-now");
  nowLine.style.left = `${x(now)}px`;

  inner.append(cols, header, rows, nowLine);
  scroller.appendChild(inner);
  root.append(legend, scroller);

  // Start at the left edge (yesterday + today visible); keep the user's position on re-render
  root._schedCleanup = enableDragScroll(scroller);
  scroller.scrollLeft = prevScroll ?? 0;

  // Keep the now-line moving
  clearInterval(root._schedTimer);
  root._schedTimer = setInterval(() => {
    nowLine.style.left = `${x(Date.now())}px`;
  }, 60_000);
}
