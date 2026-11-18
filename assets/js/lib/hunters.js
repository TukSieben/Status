// "Top hunters today": the 3 viewers who used the most badge commands today (fed by the chat echo).
// Small inline strip. Survives page reloads (saved in the browser), resets at midnight Europe/Berlin.
// URL option: ?hunters=0 (hide)

const STYLE = `
.hunt{display:flex;align-items:center;gap:14px;white-space:nowrap}
.hunt-label{font-family:var(--mono,monospace);font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--hunt-muted,#a5a3bd)}
.hunt-chip{display:flex;align-items:center;gap:8px;font-size:17px;font-weight:600;color:#fff}
.hunt-rank{font-family:var(--mono,monospace);font-size:13px;font-weight:700;color:var(--hunt-accent,#c4b5fd)}
.hunt-av{width:26px;height:26px;border-radius:50%;object-fit:cover;background:rgba(255,255,255,.15);display:grid;place-items:center;font-size:12px;font-weight:800;color:#1b1433;overflow:hidden}
.hunt-av img{width:100%;height:100%;object-fit:cover}
.hunt-n{font-family:var(--mono,monospace);font-size:14px;color:var(--hunt-muted,#a5a3bd);font-weight:500}
.hunt-empty{font-size:15px;color:var(--hunt-muted,#a5a3bd)}
`;
const KEY = "badgestatus_hunters";

function today() {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function startHunters(host, { avatarOf = async () => null } = {}) {
  if (!host || new URLSearchParams(location.search).get("hunters") === "0") return null;
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);

  let state = { day: today(), users: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved?.day === state.day) state = saved;
  } catch {}
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  };

  const box = document.createElement("div");
  box.className = "hunt";
  host.append(box);

  let lastKey = "";
  async function render() {
    if (state.day !== today()) {
      state = { day: today(), users: {} };
      save();
    }
    const top = Object.entries(state.users)
      .sort((a, b) => b[1].n - a[1].n || a[1].t - b[1].t)
      .slice(0, 3);
    const key = JSON.stringify(top.map(([l, u]) => [l, u.n]));
    if (key === lastKey) return;
    lastKey = key;
    const label = Object.assign(document.createElement("span"), { className: "hunt-label", textContent: "Top hunters today" });
    if (!top.length) {
      box.replaceChildren(label, Object.assign(document.createElement("span"), { className: "hunt-empty", textContent: "Use a badge command to get on the board" }));
      return;
    }
    const chips = await Promise.all(
      top.map(async ([login, u], i) => {
        const chip = document.createElement("span");
        chip.className = "hunt-chip";
        const rank = Object.assign(document.createElement("span"), { className: "hunt-rank", textContent: `#${i + 1}` });
        const av = document.createElement("span");
        av.className = "hunt-av";
        const pic = await Promise.race([avatarOf(login), new Promise((r) => setTimeout(() => r(null), 1500))]);
        if (pic) av.append(Object.assign(document.createElement("img"), { src: pic, alt: "" }));
        else av.textContent = u.name[0]?.toUpperCase() || "?";
        const n = Object.assign(document.createElement("span"), { className: "hunt-n", textContent: `×${u.n}` });
        chip.append(rank, av, u.name, n);
        return chip;
      })
    );
    box.replaceChildren(label, ...chips);
  }
  render();
  setInterval(render, 60_000); // midnight reset

  return {
    /** One badge command used by this viewer */
    add(name, login) {
      const l = String(login || name).toLowerCase();
      const u = state.users[l] || { name, n: 0, t: Date.now() };
      u.name = name;
      u.n += 1;
      u.t = Date.now();
      state.users[l] = u;
      save();
      render();
    },
  };
}
