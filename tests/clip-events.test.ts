import assert from "node:assert/strict";
import test from "node:test";
import { registerClipEvents } from "../src/clip-events.ts";

function setup(t: test.TestContext) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const handlers = new Map<string, Function>();
  const activity: string[] = [];
  const reactions: unknown[] = [];
  const requests: unknown[] = [];
  let cancellations = 0;
  let visible = true;
  let clipSet = true;
  const player = {
    activity(name: string) { activity.push(name); return true; },
    react(name: string, urgent: boolean) { reactions.push([name, urgent]); return true; },
    stop() {},
  };
  const events = registerClipEvents({ on: (name: string, handler: Function) => handlers.set(name, handler) } as any, {
    getPlayer: () => clipSet ? player as any : null,
    isVisible: () => visible,
    requestReaction: (input) => requests.push(input),
    cancelReaction: () => { cancellations++; },
  });
  t.after(() => events.stop());
  const emit = (name: string, event = {}) => handlers.get(name)?.(event);
  return { events, emit, activity, reactions, requests, cancellations: () => cancellations,
    hide: () => { visible = false; events.stop(); }, legacy: () => { clipSet = false; } };
}

test("maps reading and nested tools without declaring idle while a sibling still runs", (t) => {
  const { emit, activity, reactions } = setup(t);
  emit("before_agent_start", { messageType: "user", prompt: "fix this" });
  emit("tool_execution_start", { toolCallId: "parent", toolName: "codemode" });
  emit("tool_execution_start", { toolCallId: "child", toolName: "read" });
  assert.deepEqual(activity.slice(-2), ["working", "searching"]);
  emit("tool_execution_end", { toolCallId: "child", isError: false });
  assert.equal(activity.at(-1), "working");
  emit("tool_execution_end", { toolCallId: "parent", isError: true });
  assert.deepEqual(reactions.at(-1), ["error", true]);
  assert.equal(activity.at(-1), "thinking");
});

test("reasoning becomes focused after sustained work, not on each tool event", (t) => {
  const { emit, activity } = setup(t);
  emit("agent_start");
  t.mock.timers.tick(14000);
  emit("tool_execution_start", { toolCallId: "1", toolName: "bash" });
  t.mock.timers.tick(1000);
  assert.equal(activity.at(-1), "focused");
  emit("tool_execution_end", { toolCallId: "1", isError: false });
  assert.equal(activity.at(-1), "focused");
});

test("settlement classifies only the latest visible exchange, then listens, idles and sleeps", (t) => {
  const { emit, activity, requests } = setup(t);
  emit("before_agent_start", { messageType: "user", prompt: "thanks" });
  emit("message_end", { message: { role: "assistant", stopReason: "stop", content: [
    { type: "thinking", thinking: "private reasoning" }, { type: "text", text: "Happy to help." },
  ] } });
  emit("agent_end");
  assert.equal(requests.length, 0);
  emit("agent_settled");
  assert.deepEqual(requests, [{ userText: "thanks", assistantText: "Happy to help." }]);
  assert.equal(activity.at(-1), "listening");
  t.mock.timers.tick(10000);
  assert.equal(activity.at(-1), "idle");
  t.mock.timers.tick(50000);
  assert.equal(activity.at(-1), "sleepy");
});

test("a new run cancels idle timers and stale reactions; hiding cancels all work", (t) => {
  const { emit, activity, hide, cancellations } = setup(t);
  emit("agent_settled");
  t.mock.timers.tick(5000);
  emit("agent_start");
  t.mock.timers.tick(5000);
  assert.equal(activity.at(-1), "thinking");
  hide();
  const before = [...activity];
  t.mock.timers.tick(90000);
  emit("agent_settled");
  emit("tool_execution_start", { toolCallId: "hidden", toolName: "read" });
  assert.deepEqual(activity, before);
  assert.ok(cancellations() >= 2);
});

test("compaction interrupts with dizzy and missing clip sets leave legacy events alone", (t) => {
  const { emit, activity, legacy } = setup(t);
  emit("session_before_compact");
  assert.equal(activity.at(-1), "dizzy");
  emit("session_compact");
  assert.equal(activity.at(-1), "idle");
  legacy();
  emit("agent_start");
  emit("tool_execution_start", { toolCallId: "1", toolName: "read" });
  assert.equal(activity.at(-1), "idle");
});

test("queued user input updates the exchange; failed assistant output is not classified", (t) => {
  const { emit, requests } = setup(t);
  emit("before_agent_start", { messageType: "user", prompt: "old" });
  emit("message_end", { message: { role: "user", content: [{ type: "text", text: "new" }] } });
  emit("message_end", { message: { role: "assistant", stopReason: "error", content: [{ type: "text", text: "partial" }] } });
  emit("agent_settled");
  assert.equal(requests.length, 0);
});
