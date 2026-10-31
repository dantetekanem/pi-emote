import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createWidgetVisibility, registerEmoteCommand, restoreWidgetVisibility } from "../src/visibility.ts";

test("pi-emote toggle hides and restores the widget for the current session", async () => {
  const transitions: string[] = [];
  const notices: string[] = [];
  const entries: { customType: string; data: unknown }[] = [];
  const visibility = createWidgetVisibility({
    show: () => transitions.push("show"),
    hide: () => transitions.push("hide"),
  });

  let commandName = "";
  let handler: ((args: string, ctx: any) => Promise<void>) | undefined;
  registerEmoteCommand({
    appendEntry(customType: string, data: unknown) {
      entries.push({ customType, data });
    },
    registerCommand(name: string, options: { handler: typeof handler }) {
      commandName = name;
      handler = options.handler;
    },
  } as unknown as ExtensionAPI, visibility, () => {});

  visibility.show();
  assert.equal(visibility.isVisible(), true);
  assert.deepEqual(transitions, ["show"]);
  assert.equal(commandName, "pi-emote");

  const ctx = {
    hasUI: true, mode: "tui",
    ui: {
      notify(message: string) {
        notices.push(message);
      },
    },
  };

  await handler!("toggle", ctx);
  assert.equal(visibility.isVisible(), false);
  assert.deepEqual(transitions, ["show", "hide"]);
  assert.equal(notices.at(-1), "[pi-emote] Widget hidden.");
  assert.deepEqual(entries, [{ customType: "pi-emote-visibility", data: { visible: false } }]);
  const reloaded = createWidgetVisibility({ show() {}, hide() {} });
  const savedEntries = () => entries.map((entry) => ({ type: "custom", ...entry }));
  assert.equal(restoreWidgetVisibility(reloaded, savedEntries()), false);

  await handler!("toggle", ctx);
  assert.equal(visibility.isVisible(), true);
  assert.deepEqual(transitions, ["show", "hide", "show"]);
  assert.equal(notices.at(-1), "[pi-emote] Widget shown.");
  assert.deepEqual(entries.at(-1), { customType: "pi-emote-visibility", data: { visible: true } });
  assert.equal(restoreWidgetVisibility(reloaded, savedEntries()), true);
});

test("pi-emote completes subcommands and awaits the selection handler", async () => {
  let command!: Parameters<ExtensionAPI["registerCommand"]>[1];
  let finish!: () => void;
  const selection = new Promise<void>((resolve) => { finish = resolve; });
  const visibility = createWidgetVisibility({ show() {}, hide() {} });
  registerEmoteCommand({
    registerCommand(_name, options) { command = options; },
  } as ExtensionAPI, visibility, () => selection);

  assert.deepEqual(command.getArgumentCompletions!(""), [
    { value: "switch", label: "switch" },
    { value: "toggle", label: "toggle" },
  ]);
  assert.deepEqual(command.getArgumentCompletions!("sw"), [{ value: "switch", label: "switch" }]);
  assert.deepEqual(command.getArgumentCompletions!("to"), [{ value: "toggle", label: "toggle" }]);
  assert.equal(command.getArgumentCompletions!("unknown"), null);

  let settled = false;
  const run = command.handler("switch", { hasUI: true, mode: "tui" } as any).then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  finish();
  await run;
  assert.equal(settled, true);
});

test("reload restores the latest session choice without mounting a hidden widget", () => {
  const transitions: string[] = [];
  const reload = (entries: { type: string; customType?: string; data?: unknown }[]) => {
    const visibility = createWidgetVisibility({
      show: () => transitions.push("show"),
      hide: () => transitions.push("hide"),
    });
    restoreWidgetVisibility(visibility, entries);
    return visibility;
  };
  const entry = (visible: boolean) => ({
    type: "custom", customType: "pi-emote-visibility", data: { visible },
  });

  const hidden = [entry(true), entry(false)];
  assert.equal(reload(hidden).isVisible(), false);
  assert.equal(reload(hidden).isVisible(), false);
  assert.deepEqual(transitions, []);

  const shown = reload([...hidden, entry(true)]);
  assert.equal(shown.isVisible(), true);
  shown.hide(); // Runtime teardown must not overwrite the user's choice.
  assert.equal(reload([...hidden, entry(true)]).isVisible(), true);
  assert.equal(reload([]).isVisible(), true); // A new session keeps the default.
  assert.deepEqual(transitions, ["show", "hide", "show", "show"]);

  assert.equal(reload([...hidden,
    { type: "custom", customType: "another-widget", data: { visible: true } },
    { type: "custom", customType: "pi-emote-visibility", data: { visible: "true" } },
    { type: "custom", customType: "pi-emote-visibility", data: null },
  ]).isVisible(), false);
});

test("the visibility lifecycle is idempotent and ignores commands without a UI", async () => {
  const transitions: string[] = [];
  const visibility = createWidgetVisibility({
    show: () => transitions.push("show"),
    hide: () => transitions.push("hide"),
  });

  visibility.show();
  visibility.show();
  visibility.hide();
  visibility.hide();
  assert.deepEqual(transitions, ["show", "hide"]);

  let handler: ((args: string, ctx: any) => Promise<void>) | undefined;
  registerEmoteCommand({
    registerCommand(_name: string, options: { handler: typeof handler }) {
      handler = options.handler;
    },
  } as unknown as ExtensionAPI, visibility, () => {});

  await handler!("toggle", { hasUI: false, mode: "tui", ui: { notify() {} } });
  assert.equal(visibility.isVisible(), false);
  assert.deepEqual(transitions, ["show", "hide"]);
});
