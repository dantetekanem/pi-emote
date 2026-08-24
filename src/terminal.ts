import { getCapabilities } from "@earendil-works/pi-tui";
import type { TerminalMapping, ResolvedRenderer } from "./types.js";
import { detectTerminalName, isMultiplexerName, type MultiplexerName } from "./detect_terminal.js";
import { checkTmuxPassthrough, detectOuterTerminal } from "./tmux.js";
import { log } from "./log.js";

export { detectTerminalName } from "./detect_terminal.js";

type Protocol = "kitty" | "kitty-unicode" | "iterm2" | "ascii";

/**
 * Resolve which renderer to use.
 *
 * Returns a ResolvedRenderer with:
 * - protocol: the image protocol to use
 * - multiplexer: which multiplexer we're inside (null if direct)
 * - warning: optional user-facing warning message
 * - warningLevel: "warning" (actionable) or "info" (informational)
 */
export function resolveRenderer(
  terminals: TerminalMapping[],
  userConfiguredTerminals: Set<string>,
): ResolvedRenderer {
  const name = detectTerminalName();
  log(`terminal: detected "${name}"`);

  if (isMultiplexerName(name)) {
    return resolveMultiplexer(name, terminals, userConfiguredTerminals);
  }

  return resolveDirect(name, terminals);
}

/**
 * Resolve renderer for a multiplexer session.
 */
function resolveMultiplexer(
  name: MultiplexerName,
  terminals: TerminalMapping[],
  userConfiguredTerminals: Set<string>,
): ResolvedRenderer {
  const multiplexer = name;
  const base: Pick<ResolvedRenderer, "multiplexer" | "warningLevel"> = {
    multiplexer,
    warningLevel: "warning",
  };

  // Find the terminal entry for this multiplexer
  const entry = terminals.find((e) => e.match === name);
  const render = entry?.render ?? "auto";
  const isUserConfigured = userConfiguredTerminals.has(name);

  // Concrete renderer specified (not "auto") — use it directly.
  // Only suppress warnings if it was explicitly set by user/project config.
  if (render !== "auto") {
    log(`terminal: "${name}" → "${render}"${isUserConfigured ? " (user configured)" : " (default)"}`);
    return { ...base, protocol: render, warning: null };
  }

  // Auto-detection path (explicit "auto" from user, or default "auto")
  if (name === "tmux") {
    return resolveTmux(base);
  }

  // Other multiplexers use the stable text renderer unless explicitly overridden.
  const label = name;
  log(`terminal: ${label} detected, defaulting to ASCII`);
  return {
    ...base,
    protocol: "ascii",
    warningLevel: "info",
    warning: isUserConfigured
      ? null
      : name === "herdr"
        ? "[pi-emote] Herdr detected. Defaulting to ASCII because animated Kitty graphics can flicker inside Herdr."
        : `[pi-emote] ${label} detected. Image passthrough not supported... yet! Defaulting to ASCII.`,
  };
}

/**
 * Resolve renderer for tmux auto-detection.
 */
function resolveTmux(
  base: Pick<ResolvedRenderer, "multiplexer" | "warningLevel">,
): ResolvedRenderer {
  // Check if passthrough is enabled
  if (!checkTmuxPassthrough()) {
    log("terminal: tmux passthrough not enabled");
    return {
      ...base,
      protocol: "ascii",
      warning:
        "[pi-emote] tmux detected. Add 'set -g allow-passthrough on' and 'set -ga update-environment TERM_PROGRAM' to tmux.conf to enable image avatar. Defaulting to ASCII.",
    };
  }

  // Passthrough enabled — detect outer terminal
  const outer = detectOuterTerminal();
  log(`terminal: tmux passthrough enabled, outer protocol → "${outer}"`);

  if (outer === "ascii") {
    return {
      ...base,
      protocol: "ascii",
      warning:
        "[pi-emote] tmux passthrough enabled but could not detect outer terminal. Defaulting to ASCII.",
    };
  }

  // Use kitty-unicode for kitty protocol through tmux (pane-safe).
  // iTerm2 has no pane-safe equivalent — default to ascii.
  if (outer === "kitty") {
    return { ...base, protocol: "kitty-unicode", warning: null };
  }

  return {
    ...base,
    protocol: "ascii",
    warning:
      `[pi-emote] tmux + ${outer} detected. No pane-safe image renderer available. Defaulting to ASCII. Set render to \"iterm2\" to opt in (experimental).`,
  };
}

/**
 * Resolve renderer for a direct (non-multiplexer) terminal.
 */
function resolveDirect(
  name: string,
  terminals: TerminalMapping[],
): ResolvedRenderer {
  const base: ResolvedRenderer = {
    protocol: "ascii",
    multiplexer: null,
    warning: null,
    warningLevel: "warning",
  };

  // Check whitelist
  const entry = terminals.find((e) => e.match === name);
  if (entry) {
    const render = entry.render === "auto" ? detectDirectProtocol() : entry.render;
    log(`terminal: whitelist match "${name}" → render "${render}"`);
    return { ...base, protocol: render };
  }

  // No whitelist match — fall back to pi-tui capabilities
  const caps = getCapabilities();
  const fallback: Protocol = caps.images ?? "ascii";
  log(`terminal: no whitelist match for "${name}", using pi-tui capabilities → "${fallback}"`);
  return { ...base, protocol: fallback };
}

/**
 * Detect image protocol for a direct terminal using pi-tui capabilities.
 */
function detectDirectProtocol(): Protocol {
  const caps = getCapabilities();
  return caps.images ?? "ascii";
}
