// Draggable timeline ("Schedule") of active + upcoming badge events.
import { el, img, badgeHref, URGENT_MS } from "./utils.js";
import { plannedMonth } from "./planned.js?v=1";
const DAY_MS = 86_400_000;
const DAY_PX = 76;
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
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
}

function barCostClass(ev) {
  if (ev.upcoming) return "is-upcoming";
  if (ev.free > 0 && ev.paid > 0) return "is-mixed";
  return ev.paid > 0 ? "is-paid" : "is-free";
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

/** Announced events without exact dates yet ("… during December 2026"): one per event, spanning that month. */
export function buildAnnounced(badges, now = Date.now()) {
  const groups = new Map();
  const seen = new Set();
  for (const b of badges) {
    if (seen.has(b.setID) || b.startAt || b.endAt) continue;
    const month = plannedMonth(b);
    if (!(month > now)) continue;
    seen.add(b.setID);
    const key = (b.eventName || b.title || b.setID).trim();
    const d = new Date(month);
    const monthEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const g = groups.get(key) || { name: key, start: month, end: monthEnd, badges: [], paid: 0, free: 0, announced: true };
    g.start = Math.min(g.start, month);
    g.end = Math.max(g.end, monthEnd);
    g.badges.push(b);
    if (b.cost === "paid") g.paid++;
    else g.free++;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
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
  const announced = buildAnnounced(badges, now);
  const prevScroll = root.querySelector(".sched-scroll")?.scrollLeft;
  root._schedCleanup?.();
  clearInterval(root._schedTimer);
  root.replaceChildren();

  if (events.length === 0 && announced.length === 0) {
    root.appendChild(el("div", "sched-empty", "No active or upcoming badge events."));
    return;
  }

  const rangeStart = startOfLocalDay(now - DAY_MS);
  const lastEnd = Math.max(...events.map((e) => e.end), ...announced.map((e) => e.end));
  const days = Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.ceil((lastEnd - rangeStart) / DAY_MS) + 1));
  const rangeEnd = rangeStart + days * DAY_MS;
  const width = days * DAY_PX;
  const x = (ms) => ((Math.min(Math.max(ms, rangeStart), rangeEnd) - rangeStart) / DAY_MS) * DAY_PX;

  // Legend & subtle scroll controls
  const legend = el("div", "sched-legend");
  const lg = (cls, text) => {
    const item = el("span", "sched-legend-item");
    item.append(el("span", `sched-swatch ${cls}`), document.createTextNode(text));
    return item;
  };
  legend.append(
    lg("sw-now", "Current time"),
    lg("sw-free", "Free"),
    lg("sw-paid", "Paid"),
    lg("sw-mixed", "Free & Paid"),
    lg("sw-upcoming", "Upcoming"),
    lg("sw-expected", "Announced, exact dates not out yet")
  );

  const nav = el("div", "sched-nav");
  const todayBtn = el("button", "sched-nav-btn", "Today");
  todayBtn.type = "button";
  const prevBtn = el("button", "sched-nav-btn", "‹");
  prevBtn.type = "button";
  prevBtn.setAttribute("aria-label", "Scroll earlier");
  const nextBtn = el("button", "sched-nav-btn", "›");
  nextBtn.type = "button";
  nextBtn.setAttribute("aria-label", "Scroll later");
  nav.append(todayBtn, prevBtn, nextBtn);
  legend.appendChild(nav);

  const scroller = el("div", "sched-scroll");
  const inner = el("div", "sched-inner");
  inner.style.width = `${width}px`;

  // Day columns + header
  const header = el("div", "sched-header");
  const cols = el("div", "sched-cols");
  const todayStart = startOfLocalDay(now);

  for (let i = 0; i < days; i++) {
    const dayMs = rangeStart + i * DAY_MS;
    const d = new Date(dayMs);
    const isToday = todayStart === startOfLocalDay(dayMs);
    const isMonthStart = d.getDate() === 1;
    const label = d.toLocaleString("en-US", { month: "short", day: "numeric" }).toUpperCase();

    const cell = el(
      "div",
      `sched-day${i % 2 ? " is-alt" : ""}${isToday ? " is-today" : ""}${isMonthStart ? " is-month-start" : ""}`,
      label
    );
    cell.style.left = `${i * DAY_PX}px`;
    cell.style.width = `${DAY_PX}px`;
    header.appendChild(cell);

    const col = el(
      "div",
      `sched-col${i % 2 ? " is-alt" : ""}${isToday ? " is-today" : ""}${isMonthStart ? " is-month-start" : ""}`
    );
    col.style.left = `${i * DAY_PX}px`;
    col.style.width = `${DAY_PX}px`;
    cols.appendChild(col);
  }

  // Subtle wash left of current time
  const pastShade = el("div", "sched-past");
  pastShade.style.width = `${x(now)}px`;

  // Rows
  const rows = el("div", "sched-rows");
  for (const ev of events) {
    const row = el("div", "sched-row");
    const left = x(ev.start);
    const barW = Math.max(8, x(ev.end) - left);
    const clippedLeft = ev.start < rangeStart;
    const clippedRight = ev.end > rangeEnd;
    const urgent = !ev.upcoming && ev.end - now < URGENT_MS;

    const bar = el(
      "div",
      `sched-bar ${barCostClass(ev)}${clippedLeft ? " is-clipped" : ""}${clippedRight ? " is-clipped-right" : ""}`
    );
    const barHref = options.href ? options.href(ev) : badgeHref(ev.badges[0]);
    bar.setAttribute("role", "link");
    bar.tabIndex = 0;
    bar.style.left = `${left}px`;
    bar.style.width = `${barW}px`;
    bar.title = `${ev.name}\n${fmt(ev.start)} → ${fmt(ev.end)}\n${ev.badges.length} badge${ev.badges.length === 1 ? "" : "s"} · ${ev.free} free · ${ev.paid} paid`;
    bar.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
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
      const im = el("img");
      im.src = img(b, 2);
      im.alt = b.title;
      im.loading = "lazy";
      link.appendChild(im);
      icons.appendChild(link);
    }
    label.append(icons, el("span", "sched-name", ev.name));

    const rel = el(
      "span",
      `sched-rel${urgent ? " is-urgent" : ""}`,
      ev.upcoming ? `starts in ${shortRel(ev.start)}` : `ends in ${shortRel(ev.end)}`
    );
    const labelW = 18 + Math.min(ev.badges.length, 6) * 24 + ev.name.length * 7;
    if (barW < labelW + 120 + (clippedLeft ? DAY_PX * 1.2 : 0)) {
      bar.classList.add("is-narrow");
      rel.style.left = `${Math.max(barW, labelW) + 12}px`;
    }
    bar.append(label, rel);
    row.appendChild(bar);
    rows.appendChild(row);
  }

  // Announced events: hatched bar over the expected month, updated automatically once Twitch publishes dates
  if (announced.length) {
    rows.appendChild(el("div", "sched-divider", "Announced · dates coming soon"));
    for (const ev of announced) {
      const row = el("div", "sched-row");
      const left = x(ev.start);
      const barW = Math.max(8, x(ev.end) - left);
      const bar = el("div", `sched-bar is-expected${ev.end > rangeEnd ? " is-clipped-right" : ""}`);
      const barHref = options.href ? options.href(ev) : badgeHref(ev.badges[0]);
      bar.setAttribute("role", "link");
      bar.tabIndex = 0;
      bar.style.left = `${left}px`;
      bar.style.width = `${barW}px`;
      const monthName = new Date(ev.start).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
      bar.title = `${ev.name}\nExpected in ${monthName} — exact times not announced yet\n${ev.badges.length} badge${ev.badges.length === 1 ? "" : "s"}`;
      bar.addEventListener("click", (e) => {
        if (e.target.closest("a")) return;
        location.href = barHref;
      });
      const label = el("span", "sched-label");
      const icons = el("span", "sched-icons");
      for (const b of ev.badges.slice(0, 6)) {
        const link = el("a", "sched-icon");
        link.href = badgeHref(b);
        link.title = b.title;
        const im = el("img");
        im.src = img(b, 2);
        im.alt = b.title;
        im.loading = "lazy";
        link.appendChild(im);
        icons.appendChild(link);
      }
      label.append(icons, el("span", "sched-name", ev.name));
      const tba = el("span", "sched-rel", `${monthName.split(" ")[0]} · dates TBA`);
      if (left > 220) {
        // name sits at the left like a row label; the hatched bar only shows the expected month
        const ghost = el("span", "sched-ghost-label");
        ghost.append(label);
        ghost.style.left = "10px";
        ghost.style.maxWidth = `${left - 20}px`;
        row.appendChild(ghost);
        bar.classList.add("is-tba-only");
        bar.append(tba);
      } else {
        bar.append(label, tba);
      }
      row.appendChild(bar);
      rows.appendChild(row);
    }
  }

  // Now line
  const nowLine = el("div", "sched-now");
  nowLine.style.left = `${x(now)}px`;

  inner.append(cols, pastShade, header, rows, nowLine);
  scroller.appendChild(inner);
  root.append(legend, scroller);

  todayBtn.addEventListener("click", () => {
    scroller.scrollTo({ left: 0, behavior: "smooth" });
  });
  prevBtn.addEventListener("click", () => {
    scroller.scrollBy({ left: -DAY_PX * 5, behavior: "smooth" });
  });
  nextBtn.addEventListener("click", () => {
    scroller.scrollBy({ left: DAY_PX * 5, behavior: "smooth" });
  });

  root._schedCleanup = enableDragScroll(scroller);
  scroller.scrollLeft = prevScroll ?? 0;

  root._schedTimer = setInterval(() => {
    const pos = x(Date.now());
    nowLine.style.left = `${pos}px`;
    pastShade.style.width = `${pos}px`;
  }, 60_000);
}
