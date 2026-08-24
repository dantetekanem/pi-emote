import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { detectTerminalName, isMultiplexerName } from "../src/detect_terminal.ts";

test("Herdr takes precedence over leaked outer-terminal and nested multiplexer markers", () => {
  const env = {
    HERDR_ENV: "1",
    TERM_PROGRAM: "ghostty",
    TERM: "xterm-256color",
    TMUX: "/tmp/tmux/default,1,0",
  };

  assert.equal(detectTerminalName(env), "herdr");
  assert.equal(isMultiplexerName(detectTerminalName(env)), true);
});

test("terminal detection remains unchanged outside Herdr", () => {
  assert.equal(detectTerminalName({ TERM_PROGRAM: "ghostty" }), "ghostty");
  assert.equal(detectTerminalName({ TMUX: "/tmp/tmux/default,1,0", TERM_PROGRAM: "ghostty" }), "tmux");
});

test("Herdr uses pane-safe Kitty placeholders instead of dropping the image", async () => {
  const config = JSON.parse(await readFile(new URL("../config.json", import.meta.url), "utf8"));
  const herdr = config.terminals.find((terminal) => terminal.match === "herdr");

  assert.deepEqual(herdr, { match: "herdr", render: "kitty-unicode" });
});
