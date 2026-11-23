// Draggable split-column roadmap ("Drop schedule") of active + upcoming badge events.
import { el, img, badgeHref, URGENT_MS } from "./utils.js";
const DAY_MS = 86_400_000;
const DAY_PX = 64;
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

function shortDay(ms) {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

function costKind(ev) {
  if (ev.upcoming) return "upcoming";
  if (ev.free > 0 && ev.paid > 0) return "mixed";
  return ev.paid > 0 ? "paid" : "free";
}

function costLabel(ev) {
  if (ev.free > 0 && ev.paid > 0) return "Free & Paid";
  return ev.paid > 0 ? "Paid" : "Free";
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
 * Renders the split-column drop roadmap into `root`.
 * Left pinned column lists campaigns, icons, cost, and exact remaining time;
 * right scrollable track visualizes start/end windows against Today.
 */
export function renderSchedule(root, badges, options = {}) {
  const now = Date.now();
  const allEvents = buildEvents(badges, now);
  const filter = root._schedFilter || "all";
  const prevScroll = root.querySelector(".sched-scroll")?.scrollLeft;
  root._schedCleanup?.();
  clearInterval(root._schedTimer);
  root.replaceChildren();

  if (allEvents.length === 0) {
    root.appendChild(el("div", "sched-empty", "No active or upcoming badge events."));
    return;
  }

  const events = allEvents.filter((ev) => {
    if (filter === "free") return ev.free > 0;
    if (filter === "paid") return ev.paid > 0;
    return true;
  });

  const rangeStart = startOfLocalDay(now - DAY_MS);
  const lastEnd = Math.max(...allEvents.map((e) => e.end));
  const days = Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.ceil((lastEnd - rangeStart) / DAY_MS) + 2));
  const rangeEnd = rangeStart + days * DAY_MS;
  const width = days * DAY_PX;
  const x = (ms) => ((Math.min(Math.max(ms, rangeStart), rangeEnd) - rangeStart) / DAY_MS) * DAY_PX;

  // ---------- Top bar: legend + filter + scroll controls ----------
  const top = el("div", "sched-top");

  const legend = el("div", "sched-legend");
  const lg = (cls, text) => {
    const item = el("span", "sched-legend-item");
    item.append(el("span", `sched-swatch ${cls}`), document.createTextNode(text));
    return item;
  };
  legend.append(
    lg("sw-now", "Today"),
    lg("sw-free", "Free"),
    lg("sw-paid", "Paid"),
    lg("sw-mixed", "Free & Paid")
  );
  if (allEvents.some((e) => e.upcoming)) legend.appendChild(lg("sw-upcoming", "Upcoming"));

  const controls = el("div", "sched-controls");
  const filterGroup = el("div", "sched-filters");
  filterGroup.setAttribute("role", "group");
  filterGroup.setAttribute("aria-label", "Filter schedule");
  for (const [val, label] of [
    ["all", "All"],
    ["free", "Free"],
    ["paid", "Paid"],
  ]) {
    const btn = el("button", `sched-filter${filter === val ? " is-active" : ""}`, label);
    btn.type = "button";
    btn.addEventListener("click", () => {
      root._schedFilter = val;
      renderSchedule(root, badges, options);
    });
    filterGroup.appendChild(btn);
  }

  const navBtns = el("div", "sched-nav");
  const todayBtn = el("button", "sched-nav-btn", "Today");
  todayBtn.type = "button";
  const prevBtn = el("button", "sched-nav-btn", "‹");
  prevBtn.type = "button";
  prevBtn.setAttribute("aria-label", "Scroll earlier");
  const nextBtn = el("button", "sched-nav-btn", "›");
  nextBtn.type = "button";
  nextBtn.setAttribute("aria-label", "Scroll later");
  navBtns.append(todayBtn, prevBtn, nextBtn);

  controls.append(filterGroup, navBtns);
  top.append(legend, controls);

  // ---------- Split layout ----------
  const body = el("div", "sched-body");

  // Left pinned column
  const side = el("div", "sched-side");
  const sideHead = el("div", "sched-side-head");
  sideHead.append(el("span", "", "Campaign"), el("span", "sched-side-count", String(events.length)));
  const sideList = el("div", "sched-side-list");
  side.append(sideHead, sideList);

  // Right scrollable timeline
  const scroller = el("div", "sched-scroll");
  const inner = el("div", "sched-inner");
  inner.style.width = `${width}px`;

  const header = el("div", "sched-header");
  const cols = el("div", "sched-cols");
  const todayStart = startOfLocalDay(now);

  for (let i = 0; i < days; i++) {
    const dayMs = rangeStart + i * DAY_MS;
    const d = new Date(dayMs);
    const isToday = todayStart === startOfLocalDay(dayMs);
    const isFirst = d.getDate() === 1;
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;

    const cell = el(
      "div",
      `sched-day${isToday ? " is-today" : ""}${isFirst ? " is-month-start" : ""}${isWeekend ? " is-weekend" : ""}`
    );
    cell.style.left = `${i * DAY_PX}px`;
    cell.style.width = `${DAY_PX}px`;

    const monthOrWk =
      i === 0 || isFirst || isToday
        ? d.toLocaleString("en-US", { month: "short" }).toUpperCase()
        : d.toLocaleString("en-US", { weekday: "short" }).toUpperCase();
    cell.append(
      el("span", "sched-day-top", isToday ? "TODAY" : monthOrWk),
      el("span", "sched-day-num", String(d.getDate()))
    );
    header.appendChild(cell);

    const col = el(
      "div",
      `sched-col${isWeekend ? " is-weekend" : ""}${isFirst ? " is-month-start" : ""}${isToday ? " is-today" : ""}`
    );
    col.style.left = `${i * DAY_PX}px`;
    col.style.width = `${DAY_PX}px`;
    cols.appendChild(col);
  }

  const pastShade = el("div", "sched-past");
  pastShade.style.width = `${x(now)}px`;

  const rows = el("div", "sched-rows");
  const sideItems = [];
  const trackRows = [];

  if (events.length === 0) {
    sideList.appendChild(el("div", "sched-row-empty", "No matching events."));
    rows.appendChild(el("div", "sched-row-empty", ""));
  } else {
    events.forEach((ev, idx) => {
      const kind = costKind(ev);
      const urgent = !ev.upcoming && ev.end - now < URGENT_MS;
      const barHref = options.href ? options.href(ev) : badgeHref(ev.badges[0]);
      const tooltip = `${ev.name}\n${fmt(ev.start)} → ${fmt(ev.end)}\n${ev.badges.length} badge${ev.badges.length === 1 ? "" : "s"} · ${ev.free} free · ${ev.paid} paid`;

      const openBar = (e) => {
        if (e.target.closest("a")) return;
        if (e.ctrlKey || e.metaKey) window.open(barHref, "_blank");
        else location.href = barHref;
      };

      // Left row cell
      const item = el("div", "sched-item");
      item.setAttribute("role", "link");
      item.tabIndex = 0;
      item.title = tooltip;
      item.addEventListener("click", openBar);
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter") location.href = barHref;
      });

      const thumb = el("a", "sched-thumb");
      thumb.href = badgeHref(ev.badges[0]);
      thumb.title = ev.badges[0].title;
      const im = el("img");
      im.src = img(ev.badges[0], 2);
      im.alt = ev.badges[0].title;
      im.loading = "lazy";
      thumb.appendChild(im);

      const info = el("div", "sched-info");
      const name = el("div", "sched-name", ev.name);
      const meta = el("div", "sched-meta");
      const costCls = ev.free > 0 && ev.paid > 0 ? "is-mixed" : ev.paid > 0 ? "is-paid" : "is-free";
      meta.append(el("span", `sched-cost ${costCls}`, costLabel(ev)));
      if (ev.badges.length > 1) {
        meta.append(
          el("span", "sched-dot-sep sched-count-sep", "·"),
          el("span", "sched-count", `${ev.badges.length} badges`)
        );
      }
      meta.append(
        el("span", "sched-dot-sep", "·"),
        el(
          "span",
          `sched-countdown${urgent ? " is-urgent" : ""}`,
          ev.upcoming ? `starts in ${shortRel(ev.start)}` : `${shortRel(ev.end)} left`
        )
      );
      info.append(name, meta);
      item.append(thumb, info);
      sideList.appendChild(item);
      sideItems.push(item);

      // Right timeline row
      const row = el("div", "sched-row");
      const left = x(ev.start);
      const right = x(ev.end);
      const barW = Math.max(12, right - left);
      const clippedLeft = ev.start < rangeStart;
      const clippedRight = ev.end > rangeEnd;

      const bar = el(
        "div",
        `sched-bar is-${kind}${clippedLeft ? " is-clipped-left" : ""}${clippedRight ? " is-clipped-right" : ""}`
      );
      bar.setAttribute("role", "link");
      bar.tabIndex = 0;
      bar.title = tooltip;
      bar.style.left = `${left}px`;
      bar.style.width = `${barW}px`;
      bar.addEventListener("click", openBar);
      bar.addEventListener("keydown", (e) => {
        if (e.key === "Enter") location.href = barHref;
      });

      const labelStr = ev.upcoming
        ? `${shortDay(ev.start)} – ${shortDay(ev.end)}`
        : `Ends ${shortDay(ev.end)}`;
      if (barW >= 115) {
        bar.appendChild(el("span", "sched-bar-text", labelStr));
        row.appendChild(bar);
      } else {
        row.appendChild(bar);
        if (!clippedRight) {
          const ext = el("span", "sched-bar-ext", labelStr);
          ext.style.left = `${right + 8}px`;
          row.appendChild(ext);
        }
      }
      rows.appendChild(row);
      trackRows.push(row);

      // Sync hover across split columns
      const setHover = (on) => {
        item.classList.toggle("is-hover", on);
        row.classList.toggle("is-hover", on);
      };
      item.addEventListener("mouseenter", () => setHover(true));
      item.addEventListener("mouseleave", () => setHover(false));
      row.addEventListener("mouseenter", () => setHover(true));
      row.addEventListener("mouseleave", () => setHover(false));
    });
  }

  const nowLine = el("div", "sched-now");
  nowLine.style.left = `${x(now)}px`;

  inner.append(cols, pastShade, header, rows, nowLine);
  scroller.appendChild(inner);
  body.append(side, scroller);
  root.append(top, body);

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
