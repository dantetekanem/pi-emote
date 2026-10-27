import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dianaDir = join(root, "emotes", "diana");

const expectedFrames = [
  "compact/compact_1.png",
  "failure/failure_1.png",
  "hi/hi_1.png",
  "hi/hi_2.png",
  "idle/idle.png",
  "idle/idle_blink.png",
  "read/read_1.png",
  "read/read_2.png",
  "success/success_1.png",
  "talk/talk_close.png",
  "talk/talk_mid.png",
  "talk/talk_small.png",
  "talk/talk_wide.png",
  "think/think.png",
  "think/think_hard.png",
  "tool/tool_1.png",
  "tool/tool_2.png",
  "write/write_1.png",
  "write/write_2.png",
];

async function listPngFrames(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const frames = [];

  for (const entry of entries) {
    const relativePath = join(prefix, entry.name);
    if (entry.isDirectory()) {
      frames.push(...await listPngFrames(join(directory, entry.name), relativePath));
    } else if (entry.name.endsWith(".png")) {
      frames.push(relativePath);
    }
  }

  return frames.sort();
}

function readPngHeader(buffer) {
  assert.deepEqual(
    buffer.subarray(0, 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  assert.equal(buffer.toString("ascii", 12, 16), "IHDR");

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

test("Diana provides a complete, consistently sized reaction set", async () => {
  assert.deepEqual(await listPngFrames(dianaDir), expectedFrames);

  for (const relativePath of expectedFrames) {
    const buffer = await readFile(join(dianaDir, relativePath));
    assert.deepEqual(readPngHeader(buffer), { width: 128, height: 128 }, relativePath);
  }
});

test("Diana frame configuration references the shipped idle, think, and talk frames", async () => {
  const config = JSON.parse(await readFile(join(dianaDir, "emotes.json"), "utf8"));

  assert.deepEqual(config.idle, {
    default: "idle.png",
    blink: "idle_blink.png",
  });
  assert.deepEqual(config.think, {
    default: "think.png",
    hard: "think_hard.png",
  });
  assert.deepEqual(config.talk.weights, {
    "talk_close.png": 0.15,
    "talk_small.png": 0.30,
    "talk_mid.png": 0.35,
    "talk_wide.png": 0.20,
  });
});

test("the fork selects Diana for every model", async () => {
  const config = JSON.parse(await readFile(join(root, "config.json"), "utf8"));
  assert.deepEqual(config.emotes, [{ model: "*", "emote-set": "diana" }]);
});
