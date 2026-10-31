import assert from "node:assert/strict";
import test from "node:test";
import type { ClassifierContext, ClassifierResult } from "@earendil-works/pi-ai";
import { ReactionSelector, type Reaction } from "../src/reactions.ts";

const input = { userText: "Thank you!", assistantText: "The requested work is complete." };
function result(choice = "happy", probability = 0.8): ClassifierResult {
  return {
    api: "typesafe-system-one", provider: "typesafe", model: "jev-latest", timestamp: 0,
    stopReason: "stop",
    answers: { reaction: { type: "choice", choice, probabilities: { [choice]: probability }, confidence: 0.8 } },
  };
}
function harness(classify: (context: ClassifierContext, signal: AbortSignal) => Promise<ClassifierResult>, options = {}) {
  const reactions: Reaction[] = [];
  const selector = new ReactionSelector({ classify, onReaction: (reaction) => reactions.push(reaction), ...options });
  return { selector, reactions };
}

test("emits validated reactions with at least 0.60 selected probability", async () => {
  for (const reaction of ["happy", "celebrating", "love", "wink", "surprised", "confused", "sad", "grumpy"] as const) {
    const { selector, reactions } = harness(async () => result(reaction, 0.6));
    await selector.request(input);
    assert.deepEqual(reactions, [reaction]);
  }
});

test("none, uncertain, malformed, and provider-error results fail closed", async () => {
  const invalid: unknown[] = [
    result("none"), result("happy", 0.59), result("tool"), result("__proto__"),
    result("happy", NaN), result("happy", Infinity), result("happy", 1.1),
    { ...result(), stopReason: "error" }, { ...result(), stopReason: "aborted" },
    { ...result(), answers: {} }, { ...result(), answers: { reaction: { type: "bool", probability: 1 } } },
    { ...result(), answers: { reaction: { type: "choice", choice: "happy" } } },
    null,
  ];
  for (const value of invalid) {
    const { selector, reactions } = harness(async () => value as ClassifierResult);
    await assert.doesNotReject(selector.request(input));
    assert.deepEqual(reactions, []);
  }
});

test("rejected and synchronously thrown classifiers never reject request", async () => {
  for (const classify of [async () => { throw new Error("offline"); }, () => { throw new Error("sync"); }]) {
    const { selector, reactions } = harness(classify);
    await assert.doesNotReject(selector.request(input));
    assert.deepEqual(reactions, []);
  }
  const selector = new ReactionSelector({ classify: async () => result(), onReaction() { throw new Error("unmounted"); } });
  await assert.doesNotReject(selector.request(input));
});

test("submits only bounded visible user/assistant text in one choice question", async () => {
  let captured: ClassifierContext | undefined;
  const { selector } = harness(async (context) => { captured = context; return result("none"); });
  await selector.request({ userText: "u".repeat(2000), assistantText: "a".repeat(2000), thinking: "secret", tools: "payload" } as typeof input);
  assert.deepEqual(captured?.state, { userText: "u".repeat(1500), assistantText: "a".repeat(1500) });
  assert.deepEqual(Object.keys(captured!.questions), ["reaction"]);
  const question = captured!.questions.reaction;
  assert.equal(question.type, "choice");
  assert.ok(question.instructions.length > 0);
  assert.deepEqual(Object.keys(question.criteria).sort(), ["none", "happy", "celebrating", "love", "wink", "surprised", "confused", "sad", "grumpy"].sort());
  assert.equal(captured?.images, undefined);
});

test("empty input skips classification and does not spend cooldown", async () => {
  let calls = 0;
  const { selector } = harness(async () => { calls++; return result(); });
  await selector.request({ userText: " \n ", assistantText: "" });
  assert.equal(calls, 0);
  await selector.request(input);
  assert.equal(calls, 1);
});

test("default 15-second cooldown cancels pending work without starting another call", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100 });
  const pending = Promise.withResolvers<ClassifierResult>();
  const signals: AbortSignal[] = [];
  const { selector, reactions } = harness(async (_, signal) => {
    signals.push(signal);
    return signals.length === 1 ? pending.promise : result("wink");
  });
  const first = selector.request(input);
  await selector.request(input);
  await first;
  assert.equal(signals.length, 1);
  assert.equal(signals[0].aborted, true);
  pending.resolve(result());
  t.mock.timers.tick(14_999);
  await selector.request(input);
  assert.equal(signals.length, 1);
  t.mock.timers.tick(1);
  await selector.request(input);
  assert.equal(signals.length, 2);
  assert.deepEqual(reactions, ["wink"]);
});

test("default deadline settles request even when classifier ignores abort", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = Promise.withResolvers<ClassifierResult>();
  let signal: AbortSignal | undefined;
  const { selector, reactions } = harness(async (_, value) => { signal = value; return pending.promise; });
  const request = selector.request(input);
  t.mock.timers.tick(1499);
  assert.equal(signal?.aborted, false);
  t.mock.timers.tick(1);
  await request;
  assert.equal(signal?.aborted, true);
  pending.resolve(result());
  await Promise.resolve();
  assert.deepEqual(reactions, []);
});

test("latest request suppresses stale results from abort-ignoring providers", async () => {
  const pending = Promise.withResolvers<ClassifierResult>();
  let calls = 0;
  const { selector, reactions } = harness(async () => ++calls === 1 ? pending.promise : result("surprised"), { cooldownMs: 0 });
  const first = selector.request(input);
  await selector.request(input);
  await first;
  pending.resolve(result("sad"));
  await Promise.resolve();
  assert.deepEqual(reactions, ["surprised"]);
});

test("cancel is idempotent, settles pending request, and consumes late rejections", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = Promise.withResolvers<ClassifierResult>();
  let signal: AbortSignal | undefined;
  const { selector, reactions } = harness(async (_, value) => { signal = value; return pending.promise; }, { cooldownMs: 0 });
  const request = selector.request(input);
  selector.cancel();
  selector.cancel();
  await request;
  assert.equal(signal?.aborted, true);
  pending.reject(new Error("late provider failure"));
  t.mock.timers.tick(10_000);
  await Promise.resolve();
  assert.deepEqual(reactions, []);
});

test("empty newer input invalidates a pending result", async () => {
  const pending = Promise.withResolvers<ClassifierResult>();
  const { selector, reactions } = harness(async () => pending.promise);
  const request = selector.request(input);
  await selector.request({ userText: "", assistantText: "" });
  await request;
  pending.resolve(result());
  await Promise.resolve();
  assert.deepEqual(reactions, []);
});

test("a custom deadline and cooldown are honored without retries", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  let calls = 0;
  const { selector, reactions } = harness(async () => { calls++; return new Promise(() => {}); }, { timeoutMs: 25, cooldownMs: 100 });
  const first = selector.request(input);
  t.mock.timers.tick(25);
  await first;
  await selector.request(input);
  assert.equal(calls, 1);
  t.mock.timers.tick(75);
  const second = selector.request(input);
  assert.equal(calls, 2);
  selector.cancel();
  await second;
  assert.deepEqual(reactions, []);
});

test("successful and failed requests clear their deadline timers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const classify of [async () => result(), async () => { throw new Error("offline"); }]) {
    let signal: AbortSignal | undefined;
    const { selector } = harness(async (context, value) => { signal = value; return classify(); });
    await selector.request(input);
    t.mock.timers.tick(2000);
    assert.equal(signal?.aborted, false);
  }
});
