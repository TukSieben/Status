// "Add to calendar" for a badge: Google Calendar link + .ics file (Apple Calendar, Outlook, …). No login, no server.

const SITE = "https://badgestatus.net";

/** The reminder that makes sense right now: when it starts (upcoming) or its last hour (active). */
export function calendarEvent(badge, now = Date.now()) {
  const start = Date.parse(badge.startAt || "");
  const end = Date.parse(badge.endAt || "");
  const how = badge.objective || badge.description || "";
  const link = `${SITE}/badge/?id=${encodeURIComponent(badge.setID)}`;
  if (start > now) {
    return { title: `${badge.title} badge starts`, start, end: start + 3_600_000, details: `${how}\n\n${link}`, url: link };
  }
  if (end > now) {
    const from = Math.max(now, end - 3_600_000);
    return { title: `Last chance: ${badge.title} badge`, start: from, end, details: `Ends soon. ${how}\n\n${link}`, url: link };
  }
  return null;
}

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function googleCalendarUrl(ev) {
  const q = new URLSearchParams({ action: "TEMPLATE", text: ev.title, dates: `${stamp(ev.start)}/${stamp(ev.end)}`, details: ev.details });
  return `https://calendar.google.com/calendar/render?${q}`;
}

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** .ics text with a 15-minute alarm */
export function icsText(ev) {
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//BadgeStatus//Badge reminder//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${stamp(ev.start)}-${Math.random().toString(36).slice(2)}@badgestatus.net`,
    `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(ev.start)}`, `DTEND:${stamp(ev.end)}`,
    `SUMMARY:${esc(ev.title)}`, `DESCRIPTION:${esc(ev.details)}`, `URL:${ev.url}`,
    "BEGIN:VALARM", "TRIGGER:-PT15M", "ACTION:DISPLAY", `DESCRIPTION:${esc(ev.title)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}
