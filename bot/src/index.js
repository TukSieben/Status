// BadgeStatus Twitch chat bot — Cloudflare Worker.
//
// Twitch sends every chat message in the channel to POST /eventsub (EventSub webhook,
// subscription type "channel.chat.message"). The bot answers commands via the Helix
// "Send Chat Message" API. Commands come from badgestatus.net/data/badges.json, so new badges
// get a command automatically and ended badges stop answering.
//
// Routes
//   GET  /            status page (is the subscription active?)
//   GET  /auth        sign in with Twitch as the bot account (one-time authorization)
//   GET  /callback    OAuth redirect target — then creates the EventSub subscription
//   POST /eventsub    Twitch webhook
//
// Cron (wrangler.toml [triggers]): every 15 minutes the Worker starts the website's badge sync
// workflow on GitHub — GitHub's own schedule is unreliable, Cloudflare's is not.
//
// Config (wrangler.toml [vars]): CHANNEL_LOGIN, BOT_LOGIN, GITHUB_REPO
// Secrets: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, EVENTSUB_SECRET, GH_DISPATCH_TOKEN (optional)

import { handleMessage, missingMessage } from "./commands.js";

const BADGES_URL = "https://badgestatus.net/data/badges.json";
const BADGES_TTL_MS = 5 * 60 * 1000;
const COOLDOWN_MS = 5000; // same command answered at most once per 5 s
const SCOPES = ["user:read:chat", "user:write:chat", "user:bot", "channel:bot"];
const TWITCH_WEB_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"; // public client id used for badge lookups

/* ---------- in-memory caches (per Worker isolate) ---------- */

let badgesCache = { at: 0, badges: [] };
let appToken = { value: "", expires: 0 };
const userIds = new Map(); // login -> id
const seenMessages = new Map(); // EventSub message id -> time (Twitch may retry)
const lastReply = new Map(); // command -> time

/* ---------- Twitch helpers ---------- */

async function getAppToken(env) {
  if (appToken.value && Date.now() < appToken.expires - 60_000) return appToken.value;
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`App token failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  appToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return appToken.value;
}

async function helix(env, path, init = {}, token) {
  const bearer = token || (await getAppToken(env));
  const res = await fetch(`https://api.twitch.tv/helix${path}`, {
    ...init,
    headers: {
      "Client-Id": env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (res.status === 401 && !token) appToken = { value: "", expires: 0 }; // retry with a fresh token next time
  return res;
}

async function userId(env, login) {
  login = login.toLowerCase();
  if (userIds.has(login)) return userIds.get(login);
  const res = await helix(env, `/users?login=${encodeURIComponent(login)}`);
  const id = (await res.json())?.data?.[0]?.id;
  if (!id) throw new Error(`Twitch user "${login}" not found`);
  userIds.set(login, id);
  return id;
}

async function sendChat(env, message, replyTo) {
  const [broadcaster_id, sender_id] = await Promise.all([userId(env, env.CHANNEL_LOGIN), userId(env, env.BOT_LOGIN)]);
  const res = await helix(env, "/chat/messages", {
    method: "POST",
    body: JSON.stringify({ broadcaster_id, sender_id, message, ...(replyTo ? { reply_parent_message_id: replyTo } : {}) }),
  });
  if (!res.ok) console.log("sendChat failed", res.status, await res.text());
}

async function getBadges() {
  if (Date.now() - badgesCache.at < BADGES_TTL_MS && badgesCache.badges.length) return badgesCache.badges;
  try {
    const res = await fetch(BADGES_URL, { cf: { cacheTtl: 120 } });
    if (res.ok) badgesCache = { at: Date.now(), badges: (await res.json()).badges || [] };
  } catch (e) {
    console.log("badges fetch failed", String(e));
  }
  return badgesCache.badges;
}

/** Earned global badges of a user (public data, same lookup the website uses). */
async function earnedBadges(login) {
  const res = await fetch("https://gql.twitch.tv/gql", {
    method: "POST",
    headers: { "Client-ID": TWITCH_WEB_CLIENT_ID, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `query($login: String!) {
        user(login: $login) { login displayName }
        channelViewer(channelLogin: $login, userLogin: $login) { earnedBadges { setID } }
      }`,
      variables: { login },
    }),
  });
  const data = (await res.json())?.data;
  if (!data?.user) return null;
  return { displayName: data.user.displayName || login, earned: data.channelViewer?.earnedBadges || [] };
}

/* ---------- EventSub ---------- */

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handleEventSub(request, env, ctx) {
  const body = await request.text();
  const id = request.headers.get("Twitch-Eventsub-Message-Id") || "";
  const timestamp = request.headers.get("Twitch-Eventsub-Message-Timestamp") || "";
  const signature = request.headers.get("Twitch-Eventsub-Message-Signature") || "";
  const type = request.headers.get("Twitch-Eventsub-Message-Type") || "";

  // Verify the message really comes from Twitch
  const expected = `sha256=${await hmacHex(env.EVENTSUB_SECRET, id + timestamp + body)}`;
  if (!safeEqual(expected, signature)) return new Response("Bad signature", { status: 403 });
  if (Math.abs(Date.now() - Date.parse(timestamp)) > 10 * 60 * 1000) return new Response("Too old", { status: 403 });

  const payload = JSON.parse(body);
  if (type === "webhook_callback_verification") {
    return new Response(payload.challenge, { headers: { "Content-Type": "text/plain" } });
  }
  if (type === "revocation") {
    console.log("Subscription revoked:", payload.subscription?.status);
    return new Response(null, { status: 204 });
  }
  if (type !== "notification") return new Response(null, { status: 204 });

  // Ignore duplicates (Twitch retries if we answer slowly)
  if (seenMessages.has(id)) return new Response(null, { status: 204 });
  seenMessages.set(id, Date.now());
  if (seenMessages.size > 500) for (const [k, t] of seenMessages) if (Date.now() - t > 600_000) seenMessages.delete(k);

  const event = payload.event || {};
  // Answer after acknowledging, so Twitch gets its 2xx right away
  ctx.waitUntil(respond(event, env).catch((e) => console.log("respond failed", String(e))));
  return new Response(null, { status: 204 });
}

async function respond(event, env) {
  const text = event.message?.text || "";
  if (!text.startsWith("!")) return;
  if (event.chatter_user_login?.toLowerCase() === env.BOT_LOGIN.toLowerCase()) return; // never answer ourselves

  const badges = await getBadges();
  const result = handleMessage(text, badges);
  if (!result) return;

  const key = text.trim().split(/\s+/)[0].toLowerCase();
  if (Date.now() - (lastReply.get(key) || 0) < COOLDOWN_MS) return;
  lastReply.set(key, Date.now());

  if ("reply" in result) return sendChat(env, result.reply, event.message_id);

  // !missing <user>  (defaults to whoever asked)
  const login = result.missing || event.chatter_user_login;
  const info = await earnedBadges(login);
  const message = info
    ? missingMessage(login, info.displayName, info.earned, badges)
    : `Couldn't find the Twitch user "${login}".`;
  return sendChat(env, message, event.message_id);
}

/* ---------- setup: OAuth + subscription ---------- */

function callbackUrl(request) {
  return `${new URL(request.url).origin}/callback`;
}

async function subscribe(env, request) {
  const [broadcaster, bot] = await Promise.all([userId(env, env.CHANNEL_LOGIN), userId(env, env.BOT_LOGIN)]);
  const res = await helix(env, "/eventsub/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      type: "channel.chat.message",
      version: "1",
      condition: { broadcaster_user_id: broadcaster, user_id: bot },
      transport: { method: "webhook", callback: `${new URL(request.url).origin}/eventsub`, secret: env.EVENTSUB_SECRET },
    }),
  });
  const text = await res.text();
  if (res.status === 409) return { ok: true, note: "Subscription already exists." };
  return { ok: res.ok, note: res.ok ? "Subscription created." : `Twitch said ${res.status}: ${text}` };
}

async function listSubscriptions(env) {
  const res = await helix(env, "/eventsub/subscriptions?type=channel.chat.message");
  return (await res.json())?.data || [];
}

function page(title, body) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<body style="font:15px/1.5 system-ui,sans-serif;background:#09090b;color:#f4f4f5;max-width:640px;margin:60px auto;padding:0 20px">
<h1 style="font-size:22px">${title}</h1>${body}</body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* ---------- cron: keep the website's badge data fresh ---------- */

async function triggerSync(env) {
  if (!env.GH_DISPATCH_TOKEN || !env.GITHUB_REPO) return;
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/sync-badges.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "badgestatus-bot",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  if (!res.ok) console.log("sync dispatch failed", res.status, await res.text());
}

/* ---------- router ---------- */

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(triggerSync(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/eventsub") return handleEventSub(request, env, ctx);

    if (url.pathname === "/auth") {
      const state = crypto.randomUUID();
      const auth = new URL("https://id.twitch.tv/oauth2/authorize");
      auth.search = new URLSearchParams({
        response_type: "code",
        client_id: env.TWITCH_CLIENT_ID,
        redirect_uri: callbackUrl(request),
        scope: SCOPES.join(" "),
        state,
        force_verify: "true",
      });
      return new Response(null, {
        status: 302,
        headers: { Location: auth.toString(), "Set-Cookie": `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600` },
      });
    }

    if (url.pathname === "/callback") {
      const cookieState = (request.headers.get("Cookie") || "").match(/oauth_state=([\w-]+)/)?.[1];
      if (!url.searchParams.get("code") || url.searchParams.get("state") !== cookieState) {
        return page("Authorization failed", `<p>${esc(url.searchParams.get("error_description") || "Invalid or expired request.")} <a href="/auth" style="color:#c4b5fd">Try again</a></p>`);
      }
      // Exchanging the code proves the account granted the scopes; the bot then works with its app token.
      const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.TWITCH_CLIENT_ID,
          client_secret: env.TWITCH_CLIENT_SECRET,
          code: url.searchParams.get("code"),
          grant_type: "authorization_code",
          redirect_uri: callbackUrl(request),
        }),
      });
      if (!tokenRes.ok) return page("Authorization failed", `<p>${esc(await tokenRes.text())}</p>`);
      const userToken = (await tokenRes.json()).access_token;
      const who = (await (await helix(env, "/users", {}, userToken)).json())?.data?.[0];

      const sub = await subscribe(env, request);
      return page(
        sub.ok ? "BadgeStatus bot is connected ✓" : "Almost there",
        `<p>Authorized as <b>${esc(who?.display_name || "?")}</b>.</p><p>${esc(sub.note)}</p>
         <p>Bot account: <b>${esc(env.BOT_LOGIN)}</b> · Channel: <b>${esc(env.CHANNEL_LOGIN)}</b></p>
         ${sub.ok ? `<p>Try <code>!badges</code> in chat.</p>` : `<p>If the bot and the channel are different accounts, the channel owner has to open <a href="/auth" style="color:#c4b5fd">/auth</a> too (or make the bot a moderator).</p>`}`
      );
    }

    if (url.pathname === "/") {
      let subs = [];
      let error = "";
      try {
        subs = await listSubscriptions(env);
      } catch (e) {
        error = String(e);
      }
      const rows = subs.map((s) => `<li>${esc(s.type)} → <b>${esc(s.status)}</b> (${esc(s.transport?.callback || "")})</li>`).join("");
      return page(
        "BadgeStatus bot",
        `<p>Channel: <b>${esc(env.CHANNEL_LOGIN)}</b> · Bot: <b>${esc(env.BOT_LOGIN)}</b></p>
         ${error ? `<p style="color:#f87171">${esc(error)}</p>` : ""}
         <p>Subscriptions:</p><ul>${rows || "<li>none yet — open <a href='/auth' style='color:#c4b5fd'>/auth</a></li>"}</ul>`
      );
    }

    return new Response("Not found", { status: 404 });
  },
};
