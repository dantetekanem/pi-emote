import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const sourceRoot = new URL("../src/", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@earendil-works/pi-tui") return { url: `data:text/javascript,${encodeURIComponent(`
      export const getCapabilities = () => ({ images: 'kitty' });
      export const encodeITerm2 = () => '';
      export const allocateImageId = () => 1;
      export const deleteKittyImage = () => '';
      export const getCellDimensions = () => ({ widthPx: 10, heightPx: 20 });
      export const getImageDimensions = () => ({ widthPx: 256, heightPx: 256 });
      export const calculateImageRows = () => 4;
      export const visibleWidth = s => s.length;
      export const truncateToWidth = (s, n) => s.slice(0,n);
    `)}`, shortCircuit: true };
    if (context.parentURL?.startsWith(sourceRoot) && specifier.startsWith("./") && specifier.endsWith(".js")) {
      return nextResolve(specifier.replace(/\.js$/, ".ts"), context);
    }
    return nextResolve(specifier, context);
  },
});
const { default: extension } = await import("../src/index.ts");
hooks.deregister();

function setup(t, { enabled = true, clips = true, image = true, projectReactions } = {}) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"] });
  const home = mkdtempSync(join(tmpdir(), "hobkin-integration-"));
  t.mock.property(process, "env", { HOME: home, TERM_PROGRAM: "herdr", HERDR_ENV: "1" });
  const configDir = join(home, ".pi/agent/extensions/pi-emote");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), JSON.stringify({
    emotes: [{ model: "*", "emote-set": "fixture" }],
    reactions: enabled === null ? undefined : { enabled },
    terminals: [{ match: "herdr", render: image ? "kitty-unicode" : "ascii" }],
  }));
  if (projectReactions) {
    const projectDir = join(home, ".pi/extensions/pi-emote");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "config.json"), JSON.stringify({ reactions: projectReactions }));
  }
  const setDir = join(configDir, "emotes/fixture");
  mkdirSync(join(setDir, "idle"), { recursive: true });
  const names = ["idle", "hello", "listening", "thinking", "searching", "working", "focused", "error", "dizzy", "sleepy", "love"];
  const manifest = {};
  for (const name of names) {
    const frames = [0, 1].map((n) => `${name}-${n}.png`);
    for (const frame of frames) writeFileSync(join(setDir, "idle", frame), Buffer.from(frame));
    manifest[name] = { state: "idle", frames, frameMs: 100 };
  }
  writeFileSync(join(setDir, "emotes.json"), JSON.stringify(clips ? { clips: manifest, alternateSet: "fixture-black" } : {}));
  const blackDir = join(configDir, "emotes/fixture-black");
  mkdirSync(join(blackDir, "idle"), { recursive: true });
  for (const clip of Object.values(manifest)) {
    for (const frame of clip.frames) writeFileSync(join(blackDir, "idle", frame), Buffer.from(`black:${frame}`));
  }
  writeFileSync(join(blackDir, "emotes.json"), JSON.stringify({ clips: manifest, alternateSet: "fixture" }));
  const handlers = new Map();
  const commands = new Map();
  const writes = [];
  const classifications = [];
  const registryLookups = [];
  const entries = [];
  const selections = [];
  let selected = "fixture-black";
  let input;
  let draft = "";
  let resolve;
  const model = { id: "jev-latest", provider: "typesafe" };
  const ctx = {
    hasUI: true, mode: "tui", cwd: home, model: { id: "test" },
    ui: {
      notify() {}, setWidget() {}, getEditorText: () => draft,
      async select(title, options) { selections.push({ title, options }); return selected; },
      onTerminalInput(handler) { input = handler; return () => { input = undefined; }; },
    },
    sessionManager: { getEntries: () => entries, getBranch: () => entries, getSessionId: () => "test" },
    modelRegistry: {
      findOfType(kind, provider, id) {
        registryLookups.push([kind, provider, id]);
        return model;
      },
      classify(chosen, context, options) {
        assert.equal(chosen, model);
        classifications.push({ context, signal: options.signal });
        return new Promise(r => { resolve = r; });
      },
    },
  };
  t.mock.method(process.stdout, "write", data => { writes.push(String(data)); return true; });
  extension({
    on(name, handler) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); },
    registerCommand(name, options) { commands.set(name, options.handler); },
    getThinkingLevel: () => "high",
    appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
    events: { on() {} },
  });
  const emit = async (name, event = {}) => { for (const handler of handlers.get(name) ?? []) await handler(event, ctx); };
  t.after(async () => { await emit("session_shutdown"); rmSync(home, { recursive: true, force: true }); });
  const frames = () => writes.flatMap(w => [...w.matchAll(/\x1b_G[^;]+;([A-Za-z0-9+/=]+)\x1b\\/g)].map(m => Buffer.from(m[1], "base64").toString()));
  return { emit, ctx, commands, frames, classifications, registryLookups, entries, selections,
    choose(name) { selected = name; },
    type(text) { input?.(); draft = text; },
    finish: result => resolve(result) };
}

test("real extension plays clips, opts into native Jev and cancels it when hidden", async t => {
  const { emit, commands, ctx, frames, classifications, registryLookups } = setup(t);
  await emit("session_start");
  assert.equal(frames().at(-1), "idle-0.png");
  await emit("before_agent_start", { messageType: "user", prompt: "thanks" });
  await emit("agent_start");
  await emit("message_end", { message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Glad that helped." }] } });
  await emit("agent_settled");
  assert.equal(classifications.length, 1);
  assert.deepEqual(registryLookups, [["classifier", "typesafe", "jev-latest"]]);
  assert.deepEqual(classifications[0].context.state, { userText: "thanks", assistantText: "Glad that helped." });
  await commands.get("pi-emote")("toggle", ctx);
  assert.equal(classifications[0].signal.aborted, true);
  const count = frames().length;
  t.mock.timers.tick(10000);
  assert.equal(frames().length, count);
});

test("switch preserves compatible clip position and persists the chosen set", async t => {
  const { emit, commands, ctx, frames, entries, choose } = setup(t);
  await emit("session_start");
  t.mock.timers.tick(100);
  await commands.get("pi-emote")("switch", ctx);
  assert.equal(frames().at(-1), "black:idle-1.png");
  assert.deepEqual(entries.at(-1), { type: "custom", customType: "pi-emote-set", data: { setName: "fixture-black" } });
  await emit("model_select", { model: { id: "another" } });
  await emit("session_shutdown");
  await emit("session_start");
  assert.equal(frames().at(-1), "black:idle-0.png");
  await commands.get("pi-emote")("toggle", ctx);
  const count = frames().length;
  choose("red");
  await commands.get("pi-emote")("switch", ctx);
  assert.equal(frames().length, count);
  assert.notEqual(entries.at(-1).data.setName, "fixture-black");
  await commands.get("pi-emote")("toggle", ctx);
  assert.ok(frames().length > count);
});

test("typing wakes immediately, extends attention, and neither calls Jev nor interrupts work", async t => {
  const { emit, frames, type, classifications, commands, ctx } = setup(t);
  await emit("session_start");
  type("unsent private draft");
  t.mock.timers.tick(0);
  assert.equal(frames().at(-1), "listening-0.png");
  t.mock.timers.tick(100);
  type("unsent private draft more");
  t.mock.timers.tick(0);
  assert.equal(frames().at(-1), "listening-1.png");
  assert.equal(classifications.length, 0);
  for (let i = 0; i < 90; i++) t.mock.timers.tick(100);
  type("still composing");
  t.mock.timers.tick(0);
  for (let i = 0; i < 20; i++) t.mock.timers.tick(100);
  assert.ok(frames().at(-1).startsWith("listening"));
  for (let i = 0; i < 85; i++) t.mock.timers.tick(100);
  assert.ok(frames().at(-1).startsWith("idle"));
  await emit("agent_start");
  await emit("tool_execution_start", { toolCallId: "1", toolName: "bash" });
  for (let i = 0; i < 24; i++) t.mock.timers.tick(100);
  assert.ok(frames().at(-1).startsWith("working"));
  type("another draft");
  t.mock.timers.tick(0);
  assert.ok(frames().at(-1).startsWith("working"));
  await commands.get("pi-emote")("switch", ctx);
  assert.ok(frames().at(-1).startsWith("black:working"));
  await emit("tool_execution_end", { toolCallId: "1", isError: true });
  type("typing during an error");
  t.mock.timers.tick(0);
  assert.equal(frames().at(-1), "black:error-0.png");
  await commands.get("pi-emote")("toggle", ctx);
  const count = frames().length;
  type("hidden draft");
  t.mock.timers.tick(1000);
  assert.equal(frames().length, count);
});

test("set choice follows the active branch and a new session returns to the configured set", async t => {
  const { emit, commands, ctx, frames, entries } = setup(t);
  await emit("session_start");
  await commands.get("pi-emote")("switch", ctx);
  assert.equal(frames().at(-1), "black:idle-0.png");
  ctx.sessionManager.getBranch = () => [];
  await emit("session_tree");
  assert.equal(frames().at(-1), "idle-0.png");
  await commands.get("pi-emote")("switch", ctx);
  await emit("session_shutdown");
  entries.length = 0;
  await emit("session_start");
  assert.equal(frames().at(-1), "idle-0.png");
});

test("switch lists all sets, applies the selected one, and leaves cancellation unchanged", async t => {
  const { emit, commands, ctx, frames, entries, selections, choose } = setup(t);
  await emit("session_start");
  for (const name of ["red", "ascii", "fixture-black", "fixture"]) {
    choose(name);
    await commands.get("pi-emote")("switch", ctx);
    assert.equal(entries.at(-1)?.data.setName, name);
  }
  const options = selections[0].options;
  assert.deepEqual(options, [...new Set(options)].sort());
  for (const name of ["fixture-black", "default", "red", "ascii", "ascii-bear", "aza_choi"]) {
    assert.ok(options.includes(name), `selector includes ${name}`);
  }
  assert.equal(frames().at(-1), "idle-0.png");
  const savedCount = entries.length;
  const frameCount = frames().length;
  choose(undefined);
  await commands.get("pi-emote")("switch", ctx);
  assert.equal(entries.length, savedCount);
  assert.equal(frames().length, frameCount);
});

for (const options of [
  { enabled: false },
  { clips: false },
  { image: false },
  { enabled: null, projectReactions: { enabled: true } },
  { enabled: false, projectReactions: { enabled: true } },
  { projectReactions: { classifier: "other/private" } },
  { projectReactions: { enabled: false } },
]) {
  test(`no semantic calls when unavailable: ${JSON.stringify(options)}`, async t => {
    const { emit, classifications, registryLookups } = setup(t, options);
    await emit("session_start");
    await emit("before_agent_start", { messageType: "user", prompt: "thanks" });
    await emit("message_end", { message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Done." }] } });
    await emit("agent_settled");
    assert.equal(classifications.length, 0);
    assert.equal(registryLookups.length, 0);
  });
}
