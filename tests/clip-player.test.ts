import assert from "node:assert/strict";
import test from "node:test";
import { ClipPlayer } from "../src/clip-player.ts";

const clips = Object.fromEntries(["idle", "sleepy", "listening", "working", "searching", "happy", "error"].map((name) => [name, {
  state: "idle" as const, frames: [0, 1, 2, 3].map((i) => `${name}-${i}.png`), frameMs: 200,
}]));

function setup(t: test.TestContext, reducedMotion = false) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const shown: string[] = [];
  const player = new ClipPlayer(clips, (_state, file) => { shown.push(file); return true; }, { minHoldMs: 2400, reducedMotion });
  t.after(() => player.stop());
  const advance = (ms: number) => { for (let n = 0; n < ms; n += 100) t.mock.timers.tick(Math.min(100, ms - n)); };
  return { player, shown, advance };
}

test("plays sequential loops without restarting repeated activity", (t) => {
  const { player, shown, advance } = setup(t);
  player.activity("working");
  advance(200);
  player.activity("working");
  advance(600);
  assert.deepEqual(shown, ["working-0.png", "working-1.png", "working-2.png", "working-3.png", "working-0.png"]);
});

test("coalesces rapid changes, holds 2.4 seconds and switches only at a loop boundary", (t) => {
  const { player, shown, advance } = setup(t);
  player.activity("idle");
  advance(500);
  player.activity("working");
  player.activity("searching");
  advance(1800);
  assert.equal(shown.at(-1), "idle-3.png");
  advance(100);
  assert.equal(shown.at(-1), "searching-0.png");
  assert.ok(shown.every((name) => !name.startsWith("working")));
});

test("a short activity burst returning to the current state does not replay later", (t) => {
  const { player, shown, advance } = setup(t);
  player.activity("idle");
  player.activity("working");
  player.activity("idle");
  advance(4000);
  assert.ok(shown.every((name) => name.startsWith("idle")));
});

test("reactions finish their dwell then return to the latest activity; urgent errors interrupt", (t) => {
  const { player, shown, advance } = setup(t);
  player.activity("working");
  advance(100);
  player.react("error", true);
  assert.equal(shown.at(-1), "error-0.png");
  player.activity("searching");
  advance(2300);
  assert.ok(shown.at(-1)?.startsWith("error"));
  advance(100);
  assert.equal(shown.at(-1), "searching-0.png");
  player.react("happy");
  advance(2400);
  assert.equal(shown.at(-1), "happy-0.png");
  advance(2400);
  assert.equal(shown.at(-1), "searching-0.png");
});

test("new activity discards a pending semantic reaction and stop cancels all playback", (t) => {
  const { player, shown, advance } = setup(t);
  player.activity("idle");
  player.react("happy");
  player.activity("working");
  advance(2400);
  assert.equal(shown.at(-1), "working-0.png");
  player.stop();
  const before = [...shown];
  advance(10000);
  assert.deepEqual(shown, before);
  player.activity("idle");
  assert.equal(shown.at(-1), "idle-0.png");
});

test("reduced motion uses one pose per expression while retaining dwell and reaction expiry", (t) => {
  const { player, shown, advance } = setup(t, true);
  player.activity("idle");
  player.activity("working");
  advance(2300);
  assert.deepEqual(shown, ["idle-0.png"]);
  advance(100);
  assert.deepEqual(shown, ["idle-0.png", "working-0.png"]);
  player.react("error", true);
  advance(2400);
  assert.deepEqual(shown.slice(-2), ["error-0.png", "working-0.png"]);
});

test("malformed or missing clips cannot start timers or select missing frames", (t) => {
  const { player, shown, advance } = setup(t);
  assert.equal(player.activity("missing"), false);
  assert.equal(player.react("missing"), false);
  const bad = new ClipPlayer({ bad: { state: "idle", frameMs: 0, frames: [] } }, () => { throw Error("must not render"); });
  assert.equal(bad.activity("bad"), false);
  advance(10000);
  assert.deepEqual(shown, []);
  bad.stop();
});

test("typing wakes resting clips immediately without restarting attention or interrupting work", (t) => {
  const { player, shown, advance } = setup(t);
  player.activity("sleepy");
  assert.equal(player.wake(), true);
  assert.equal(shown.at(-1), "listening-0.png");
  advance(200);
  player.wake();
  player.refresh();
  assert.equal(shown.at(-1), "listening-1.png");
  player.activity("working");
  assert.equal(player.wake(), false);
  player.react("error", true);
  assert.equal(player.wake(), false);
  assert.equal(shown.at(-1), "error-0.png");
});

test("invalid hold configuration falls back to safe pacing", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const shown: string[] = [];
  const player = new ClipPlayer(clips, (_state, file) => { shown.push(file); return true; }, { minHoldMs: NaN });
  t.after(() => player.stop());
  player.activity("idle");
  player.activity("working");
  for (let i = 0; i < 24; i++) t.mock.timers.tick(100);
  assert.equal(shown.at(-1), "working-0.png");
});
