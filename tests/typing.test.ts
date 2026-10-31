import assert from "node:assert/strict";
import test from "node:test";
import { watchTyping } from "../src/typing.ts";

test("observes actual editor changes without consuming input or forwarding drafts", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let text = "";
  let input!: () => undefined;
  let detached = false;
  const calls: unknown[][] = [];
  const stop = watchTyping({
    getEditorText: () => text,
    onTerminalInput(handler) { input = handler as typeof input; return () => { detached = true; }; },
  }, (...args) => calls.push(args));
  assert.equal(input(), undefined);
  t.mock.timers.tick(0);
  assert.equal(calls.length, 0); // Navigation/terminal reports do not edit the prompt.
  input();
  text = "private draft 日本語";
  t.mock.timers.tick(0);
  assert.deepEqual(calls, [[]]);
  input();
  text = "replacement";
  input(); // One callback for a coalesced input burst.
  t.mock.timers.tick(0);
  assert.deepEqual(calls, [[], []]);
  input();
  text = "not observed after teardown";
  stop();
  t.mock.timers.tick(0);
  assert.equal(detached, true);
  assert.equal(calls.length, 2);
});
