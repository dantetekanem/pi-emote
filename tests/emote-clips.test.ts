import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEmotesConfig } from "../src/emotes.ts";

test("clip manifests preserve ordered frames and legacy configuration", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "emote-clips-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "idle"));
  writeFileSync(join(dir, "idle/one.png"), "frame");
  const config = { idle: { default: "one.png" }, clips: { idle: { state: "idle", frames: ["one.png"], frameMs: 100 } } };
  writeFileSync(join(dir, "emotes.json"), JSON.stringify(config));
  assert.deepEqual(loadEmotesConfig(dir), config);
});

test("missing or invalid clip frames fall back to the legacy set configuration", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "emote-clips-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const clips of [
    { idle: { state: "idle", frames: ["missing.png"], frameMs: 100 } },
    { idle: { state: "../outside", frames: ["one.png"], frameMs: 100 } },
    { idle: null },
    "invalid",
  ]) {
    writeFileSync(join(dir, "emotes.json"), JSON.stringify({ idle: { default: "idle.png" }, clips }));
    assert.deepEqual(loadEmotesConfig(dir), { idle: { default: "idle.png" } });
  }
});
