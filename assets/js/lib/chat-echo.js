// Chat echo: when someone uses a badge command in chat, a small bubble slides in on the stream
// ("max123 checked !GTA6FREE") and fades out after a few seconds. Reads the channel's chat anonymously
// (read-only, no login) straight from Twitch, so it works in OBS and in the server stream alike.
// URL options: ?echo=0 (off) · ?channel=name (default badgestatus) · ?echodemo=1 (sample bubbles)

const STYLE = `
.echo-stack{position:absolute;display:flex;flex-direction:column;align-items:flex-end;gap:12px;z-index:20;pointer-events:none}
.echo-bubble{display:flex;align-items:center;gap:14px;padding:10px 22px 10px 10px;border-radius:999px;
  background:var(--echo-bg,rgba(14,11,30,.92));border:1px solid var(--echo-border,rgba(255,255,255,.14));
  font:500 22px/1 var(--sans,Inter,system-ui,sans-serif);color:#fff;white-space:nowrap;
  transform:translateX(60px);opacity:0;transition:transform .5s cubic-bezier(.2,.7,.2,1),opacity .5s}
.echo-bubble.in{transform:none;opacity:1}
.echo-bubble.out{opacity:0;transform:translateY(-10px);transition:transform .7s ease,opacity .7s ease}
.echo-av{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;font-size:18px;font-weight:800;color:#1b1433}
.echo-name{font-weight:700}
.echo-verb{color:var(--echo-muted,#b4b2c9);font-weight:500}
.echo-cmd{color:var(--echo-accent,#f4a8d0);font-weight:800}
`;

const FIXED = new Set(["badges", "badge", "next", "ending", "missing", "badgestatus", "activebadges", "nextdrop", "endingsoon", "mybadges", "badgehelp"]);
const PALETTE = ["#c4b5fd", "#9fe1cb", "#f4c0d1", "#fac775", "#b5d4f4", "#f5c4b3"];
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

const key = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Short campaign commands like the bot makes them (GTA6, GTA6FREE, PAY, WOW, PKMN, …) — good enough to recognise them */
function aliasKeys(badges) {
  const out = new Set();
  const base = (t) => String(t || "").replace(/\s*\((subscribe|watch|sub)\)\s*$/i, "").trim();
  const now = Date.now();
  const groups = new Map();
  for (const b of badges) {
    const end = Date.parse(b.endAt || "");
    if (Number.isNaN(end) || end <= now - 86_400_000) continue;
    out.add(key(b.title));
    out.add(key(b.setID));
    const pokemon = /pok[eé]mon|^evolution for /i.test(b.eventName || "");
    const game = (b.game && !/[,(]/.test(base(b.game)) ? base(b.game) : base(b.eventName)) || b.title;
    const name = pokemon ? "pokemon" : base(b.eventName) || game;
    const g = groups.get(name) || { game, pokemon, titles: new Set() };
    g.titles.add(b.title);
    groups.set(name, g);
  }
  for (const g of groups.values()) {
    if (g.pokemon) {
      out.add("pkmn");
      continue;
    }
    const words = g.game.toLowerCase().match(/[a-z0-9]+/g) || [];
    const last = words[words.length - 1] || "";
    const num = ROMAN[last] ? String(ROMAN[last]) : /^\d+$/.test(last) ? last : "";
    const head = num ? words.slice(0, -1) : words;
    if (head.length >= 2) {
      const ini = head.map((w) => w[0]).join("") + num;
      out.add(ini);
      out.add(ini + "free");
    }
    const colon = /^([A-Za-z0-9]{3,}):/.exec(g.game)?.[1];
    if (colon) out.add(colon.toLowerCase());
    if (head[0]) out.add(head[0].slice(0, 3));
    for (const t of g.titles) out.add(key(t.replace(/^the\s+/i, "")).replace(/([a-z])\d+$/, "$1"));
  }
  out.delete("");
  return out;
}

export function startChatEcho(host, { position = { right: 64, bottom: 120 }, getBadges = () => [] } = {}) {
  const params = new URLSearchParams(location.search);
  if (params.get("echo") === "0") return;
  const channel = (params.get("channel") || "badgestatus").toLowerCase().replace(/^#/, "");

  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);
  const stack = document.createElement("div");
  stack.className = "echo-stack";
  Object.assign(stack.style, Object.fromEntries(Object.entries(position).map(([k, v]) => [k, `${v}px`])));
  host.append(stack);

  let known = new Set();
  let knownAt = 0;
  const commands = () => {
    if (Date.now() - knownAt > 60_000) {
      known = aliasKeys(getBadges() || []);
      knownAt = Date.now();
    }
    return known;
  };

  const recent = new Map(); // "user|cmd" → time (no repeats within 15 s)
  function show(name, cmd, color) {
    const id = `${name.toLowerCase()}|${cmd.toLowerCase()}`;
    if (Date.now() - (recent.get(id) || 0) < 15_000) return;
    recent.set(id, Date.now());

    const b = document.createElement("div");
    b.className = "echo-bubble";
    const av = document.createElement("span");
    av.className = "echo-av";
    av.style.background = color || PALETTE[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % PALETTE.length];
    av.textContent = name[0]?.toUpperCase() || "?";
    const n = Object.assign(document.createElement("span"), { className: "echo-name", textContent: name });
    const v = Object.assign(document.createElement("span"), { className: "echo-verb", textContent: "checked" });
    const c = Object.assign(document.createElement("span"), { className: "echo-cmd", textContent: cmd });
    b.append(av, n, v, c);
    stack.append(b);
    requestAnimationFrame(() => requestAnimationFrame(() => b.classList.add("in")));
    setTimeout(() => {
      b.classList.add("out");
      setTimeout(() => b.remove(), 750);
    }, 6000);
    while (stack.children.length > 3) stack.firstChild.remove();
  }

  /** A chat line → bubble if it is a badge command */
  function handle(name, text, color) {
    const m = String(text).trim().match(/^!([A-Za-z0-9_-]{2,40})\b/);
    if (!m) return;
    const k = key(m[1]);
    if (!FIXED.has(k) && !commands().has(k)) return;
    show(name, `!${m[1]}`, color);
  }

  if (params.get("echodemo") === "1") {
    const demo = [["max123", "!GTA6FREE"], ["lena_", "!next"], ["tuk7", "!PAY"], ["vicecity_fan", "!GTA6"], ["noah", "!badges"]];
    let i = 0;
    setInterval(() => {
      const [n, t] = demo[i++ % demo.length];
      recent.clear();
      handle(n, t);
    }, 2200);
  }

  // Anonymous, read-only Twitch chat connection
  let delay = 2000;
  function connect() {
    let ws;
    try {
      ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    } catch {
      return setTimeout(connect, (delay = Math.min(delay * 2, 60_000)));
    }
    ws.onopen = () => {
      delay = 2000;
      ws.send("CAP REQ :twitch.tv/tags");
      ws.send("PASS SCHMOOPIIE");
      ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
      ws.send(`JOIN #${channel}`);
    };
    ws.onmessage = (e) => {
      for (const line of String(e.data).split("\r\n")) {
        if (line.startsWith("PING")) {
          ws.send("PONG :tmi.twitch.tv");
          continue;
        }
        const m = line.match(/^(?:@(\S+) )?:(\w+)!\S+ PRIVMSG #\S+ :(.*)$/);
        if (!m) continue;
        const tags = Object.fromEntries((m[1] || "").split(";").map((t) => t.split("=")));
        handle(tags["display-name"] || m[2], m[3], tags.color || "");
      }
    };
    ws.onclose = () => setTimeout(connect, (delay = Math.min(delay * 2, 60_000)));
    ws.onerror = () => ws.close();
  }
  connect();
}
