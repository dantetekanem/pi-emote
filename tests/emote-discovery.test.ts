import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listEmoteSets, findEmoteSetDir } from "../src/emotes.ts";

test("discovers installed image and ASCII sets across layers, sorted and deduplicated", (t) => {
  const root = mkdtempSync(join(tmpdir(), "emote-discovery-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home");
  t.mock.property(process, "env", { ...process.env, HOME: home });
  const ext = join(root, "ext");
  const cwd = join(root, "project");
  const roots = [
    join(ext, "emotes"),
    join(home, ".pi/agent/extensions/pi-emote/emotes"),
    join(cwd, ".pi/extensions/pi-emote/emotes"),
  ];
  for (const [i, dir] of roots.entries()) {
    mkdirSync(join(dir, "shared/idle"), { recursive: true });
    writeFileSync(join(dir, "shared/idle/idle.png"), "frame");
    mkdirSync(join(dir, `ascii-${i}`), { recursive: true });
    writeFileSync(join(dir, `ascii-${i}/ascii.yaml`), "idle: hello");
    mkdirSync(join(dir, "empty"), { recursive: true });
  }
  assert.deepEqual(listEmoteSets(ext, cwd), ["ascii-0", "ascii-1", "ascii-2", "shared"]);
  assert.equal(findEmoteSetDir("shared", ext, cwd), join(roots[2], "shared"));
  assert.deepEqual(listEmoteSets(join(root, "missing"), join(root, "elsewhere")), ["ascii-1", "shared"]);
});
