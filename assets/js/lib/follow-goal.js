// Follower goal: "309 / 500 followers" with a slim bar. Counts live (public Twitch data, every 60 s, plus +1
// right away when the bot thanks a new follower). When a goal is reached it celebrates and moves on by itself:
// 50 → 100 → 250 → 500 → 750 → 1,000 → 1,500 → 2,000 → 2,500 → 3,000 → 4,000 → 5,000 → 7,500 → 10,000 → +5,000 …
// URL options: ?goal=1000 (fixed goal) · ?channel=name · ?goal=0 (hide)
import { gql } from "./utils.js";

const MILESTONES = [50, 100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000];
export function nextGoal(count) {
  for (const m of MILESTONES) if (m > count) return m;
  return (Math.floor(count / 5000) + 1) * 5000;
}

const STYLE = `
.goal{display:flex;flex-direction:column;gap:8px;min-width:260px}
.goal-row{display:flex;align-items:baseline;justify-content:space-between;gap:16px;font-family:var(--mono,monospace)}
.goal-label{font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:var(--goal-muted,#a5a3bd)}
.goal-num{font-size:24px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums}
.goal-num span{color:var(--goal-muted,#a5a3bd);font-weight:500}
.goal-bar{height:8px;border-radius:99px;background:rgba(255,255,255,.14);overflow:hidden}
.goal-fill{height:100%;border-radius:inherit;background:var(--goal-accent,#a78bfa);transition:width 1.2s cubic-bezier(.2,.7,.2,1)}
.goal.is-done .goal-fill{background:#34d399}
`;

export function startFollowGoal(host, { onMilestone = () => {} } = {}) {
  const params = new URLSearchParams(location.search);
  if (params.get("goal") === "0" || !host) return null;
  const channel = (params.get("channel") || "badgestatus").toLowerCase();
  const fixed = Number(params.get("goal")) || 0;

  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);
  host.innerHTML = "";
  const box = document.createElement("div");
  box.className = "goal";
  box.innerHTML = `<div class="goal-row"><span class="goal-label">Followers</span><span class="goal-num"><b>–</b><span> / –</span></span></div><div class="goal-bar"><div class="goal-fill" style="width:0%"></div></div>`;
  host.append(box);
  const numEl = box.querySelector(".goal-num b");
  const goalEl = box.querySelector(".goal-num span");
  const fill = box.querySelector(".goal-fill");

  let count = null;
  let goal = 0;
  let holding = false; // full bar stays up for a moment after a goal is reached
  function paint() {
    if (count === null) return;
    if (!holding && (!goal || (!fixed && count >= goal))) goal = fixed || nextGoal(count);
    numEl.textContent = count.toLocaleString("en-US");
    goalEl.textContent = ` / ${goal.toLocaleString("en-US")}`;
    fill.style.width = `${Math.min(100, (count / goal) * 100)}%`;
    box.classList.toggle("is-done", count >= goal);
  }

  /** New count from anywhere; celebrates every milestone crossed */
  function set(next) {
    if (!Number.isFinite(next)) return;
    const before = count;
    count = next;
    if (before !== null && next > before) {
      const crossed = (fixed ? [fixed] : MILESTONES).filter((m) => before < m && next >= m);
      if (!fixed && next >= 10000 && Math.floor(next / 5000) > Math.floor(before / 5000)) crossed.push(Math.floor(next / 5000) * 5000);
      if (crossed.length) {
        const m = Math.max(...crossed);
        // show the full bar first, then move on to the next goal
        goal = m;
        holding = true;
        paint();
        onMilestone(m);
        setTimeout(() => {
          holding = false;
          goal = fixed || nextGoal(count);
          paint();
        }, 9000);
        return;
      }
    }
    paint();
  }

  async function poll() {
    try {
      const d = await gql("query($l:String!){user(login:$l){followers{totalCount}}}", { l: channel });
      const total = d?.user?.followers?.totalCount;
      if (Number.isFinite(total) && (count === null || total >= count || count - total > 2)) set(total);
    } catch {
      /* try again next time */
    }
  }
  poll();
  setInterval(poll, 60_000);

  return {
    bump() {
      if (count !== null) set(count + 1);
    },
  };
}
