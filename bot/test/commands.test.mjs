// Run: node --test bot/test/commands.test.mjs   (uses the real data/badges.json)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleMessage, missingMessage, badgeCommands, commandKey } from "../src/commands.js";

const { badges } = JSON.parse(readFileSync(new URL("../../data/badges.json", import.meta.url)));
const NOW = Date.parse("2026-11-17T20:00:00Z");

test("command keys", () => {
  assert.equal(commandKey("Welcome 2 Miami"), "welcome2miami");
  assert.equal(commandKey("DOOM: The Dark Ages"), "doomthedarkages");
  assert.equal(commandKey("welcome-2-miami"), "welcome2miami");
  assert.equal(commandKey("Pokémon"), "pokemon");
});

test("active badge command", () => {
  const r = handleMessage("!Gallica", badges, NOW);
  assert.ok(r.reply.includes("Metaphor: ReFantazio"));
  assert.ok(r.reply.includes("Prime doesn't count"));
  assert.ok(r.reply.includes("badgestatus.net/badge/?id=gallica"));
  assert.ok(r.reply.length <= 500);
});

test("free badge says Free badge!", () => {
  assert.ok(handleMessage("!clover", badges, NOW).reply.startsWith("Free badge!"));
});

test("upcoming badge command", () => {
  const r = handleMessage("!welcome2miami", badges, NOW);
  assert.ok(r.reply.includes("is coming"), r.reply);
});

test("set id and !badge <name> work", () => {
  assert.ok(handleMessage("!warrior-jar-alexander", badges, NOW).reply.includes("ELDEN RING"));
  assert.ok(handleMessage("!badge gallica", badges, NOW).reply.includes("badge/?id=gallica"));
});

test("ended badges are deactivated", () => {
  const later = Date.parse("2027-06-01T00:00:00Z");
  assert.equal(handleMessage("!gallica", badges, later), null);
  assert.equal(badgeCommands(badges, later).has("gallica"), false);
});

test("unknown commands are ignored", () => {
  assert.equal(handleMessage("!so someone", badges, NOW), null);
  assert.equal(handleMessage("hello chat", badges, NOW), null);
});

test("general commands", () => {
  for (const c of ["!badges", "!next", "!ending", "!badgestatus"]) {
    const r = handleMessage(c, badges, NOW);
    assert.ok(r.reply.length > 10 && r.reply.length <= 500, c);
  }
  assert.deepEqual(handleMessage("!missing @Tuk7", badges, NOW), { missing: "tuk7" });
  assert.deepEqual(handleMessage("!missing", badges, NOW), { missing: null });
});

test("missing message", () => {
  const msg = missingMessage("tuk7", "Tuk7", [{ setID: "clover" }], badges, NOW);
  assert.ok(msg.startsWith("Tuk7 is missing"), msg);
  assert.ok(msg.length <= 500);
});
