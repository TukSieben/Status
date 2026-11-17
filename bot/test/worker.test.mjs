// End-to-end test of the Worker with Twitch + badgestatus.net mocked.
// Run: node --test bot/test/worker.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import worker from "../src/index.js";

const env = {
  TWITCH_CLIENT_ID: "cid",
  TWITCH_CLIENT_SECRET: "secret",
  EVENTSUB_SECRET: "eventsub-secret-123",
  CHANNEL_LOGIN: "badgestatus",
  BOT_LOGIN: "badgestatus",
};
const badgesJson = readFileSync(new URL("../../data/badges.json", import.meta.url), "utf8");
const sent = [];

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.startsWith("https://id.twitch.tv/oauth2/token")) return Response.json({ access_token: "apptoken", expires_in: 3600 });
  if (url.startsWith("https://api.twitch.tv/helix/users")) return Response.json({ data: [{ id: "1234", display_name: "BadgeStatus" }] });
  if (url.startsWith("https://api.twitch.tv/helix/chat/messages")) {
    sent.push(JSON.parse(init.body));
    return Response.json({ data: [{ is_sent: true }] });
  }
  if (url.startsWith("https://badgestatus.net/data/badges.json")) return new Response(badgesJson);
  if (url.startsWith("https://gql.twitch.tv/gql"))
    return Response.json({ data: { user: { login: "tuk7", displayName: "Tuk7" }, channelViewer: { earnedBadges: [{ setID: "clover" }] } } });
  throw new Error("unexpected fetch " + url);
};

function signed(type, payload, secret = env.EVENTSUB_SECRET) {
  const body = JSON.stringify(payload);
  const id = crypto.randomUUID();
  const ts = new Date().toISOString();
  const sig = "sha256=" + createHmac("sha256", secret).update(id + ts + body).digest("hex");
  return new Request("https://bot.example.workers.dev/eventsub", {
    method: "POST",
    body,
    headers: {
      "Twitch-Eventsub-Message-Id": id,
      "Twitch-Eventsub-Message-Timestamp": ts,
      "Twitch-Eventsub-Message-Signature": sig,
      "Twitch-Eventsub-Message-Type": type,
    },
  });
}

async function run(req) {
  const pending = [];
  const res = await worker.fetch(req, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  return res;
}

const chat = (text, login = "viewer1") => ({
  subscription: { type: "channel.chat.message" },
  event: { message_id: crypto.randomUUID(), chatter_user_login: login, message: { text } },
});

test("answers the Twitch webhook challenge", async () => {
  const res = await run(signed("webhook_callback_verification", { challenge: "abc123" }));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "abc123");
});

test("rejects bad signatures", async () => {
  const res = await run(signed("notification", chat("!badges"), "wrong-secret"));
  assert.equal(res.status, 403);
});

test("replies to a badge command", async () => {
  sent.length = 0;
  const res = await run(signed("notification", chat("!Gallica")));
  assert.equal(res.status, 204);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].broadcaster_id, "1234");
  assert.ok(sent[0].message.includes("Metaphor: ReFantazio"), sent[0].message);
  assert.ok(sent[0].reply_parent_message_id);
});

test("!missing looks up the user", async () => {
  sent.length = 0;
  await run(signed("notification", chat("!missing tuk7")));
  assert.ok(sent[0]?.message.startsWith("Tuk7 is missing"), sent[0]?.message);
});

test("ignores normal chat, unknown commands and its own messages", async () => {
  sent.length = 0;
  await run(signed("notification", chat("hello")));
  await run(signed("notification", chat("!lurk")));
  await run(signed("notification", chat("!next", "badgestatus")));
  assert.equal(sent.length, 0);
});

test("cooldown: same command twice in a row answers once", async () => {
  sent.length = 0;
  await run(signed("notification", chat("!ending")));
  await run(signed("notification", chat("!ending")));
  assert.equal(sent.length, 1);
});

test("cron triggers the GitHub sync workflow when a token is set", async () => {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(null, { status: 204 });
  };
  const pending = [];
  await worker.scheduled({}, { ...env, GITHUB_REPO: "TukSieben/Status", GH_DISPATCH_TOKEN: "ghtoken" }, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  globalThis.fetch = prev;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/repos/TukSieben/Status/actions/workflows/sync-badges.yml/dispatches");
  assert.equal(JSON.parse(calls[0].init.body).ref, "main");
});
