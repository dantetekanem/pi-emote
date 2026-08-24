export type TerminalEnvironment = Readonly<Record<string, string | undefined>>;
export type MultiplexerName = "herdr" | "tmux" | "screen" | "zellij";

const MULTIPLEXERS = new Set<MultiplexerName>(["herdr", "tmux", "screen", "zellij"]);

export function isMultiplexerName(name: string): name is MultiplexerName {
  return MULTIPLEXERS.has(name as MultiplexerName);
}

/** Detect the terminal or multiplexer from its environment markers. */
export function detectTerminalName(env: TerminalEnvironment = process.env): string {
  const termProgram = (env.TERM_PROGRAM ?? "").toLowerCase();
  const term = (env.TERM ?? "").toLowerCase();

  // Herdr inherits outer-terminal markers. Prefer its explicit marker so image
  // renderers do not mistake a Herdr pane for a direct Ghostty/Kitty session.
  if (env.HERDR_ENV === "1") return "herdr";

  if (env.ZELLIJ_SESSION_NAME || env.ZELLIJ) return "zellij";
  if (env.TMUX || term.startsWith("tmux")) return "tmux";
  if (term.startsWith("screen")) return "screen";

  if (env.KITTY_WINDOW_ID || termProgram === "kitty") return "kitty";
  if (env.GHOSTTY_RESOURCES_DIR || termProgram === "ghostty" || term.includes("ghostty")) return "ghostty";
  if (env.WEZTERM_PANE || termProgram === "wezterm") return "wezterm";
  if (env.ITERM_SESSION_ID || termProgram === "iterm.app") return "iterm2";
  if (termProgram === "vscode") return "vscode";
  if (termProgram === "alacritty") return "alacritty";
  if (termProgram === "warpterminal") return "warpterminal";

  return "unknown";
}
