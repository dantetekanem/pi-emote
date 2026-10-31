import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ClipPlayer } from "./clip-player.js";
import type { ReactionInput } from "./reactions.js";

interface ClipEventsOptions {
  getPlayer: () => ClipPlayer | null;
  isVisible: () => boolean;
  requestReaction: (input: ReactionInput) => void;
  cancelReaction: () => void;
}

function visibleText(content: unknown): string {
  if (typeof content === "string") return content.slice(-1500);
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text).join("\n").slice(-1500);
}

/** Native activity is authoritative; semantic reactions are requested only after settlement. */
export function registerClipEvents(pi: ExtensionAPI, options: ClipEventsOptions) {
  const tools = new Map<string, string>();
  let busy = false;
  let focused = false;
  let userText = "";
  let assistantText = "";
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const active = () => options.isVisible() ? options.getPlayer() : null;
  const later = (delay: number, callback: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (active()) callback();
    }, delay);
    timers.add(timer);
  };
  function clearTimers() {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }
  function working() {
    const name = [...tools.values()].at(-1);
    const reading = name && /^(read|grep|find|ls|agentic_search|web_search|fetch_content)$/.test(name);
    let expression = "thinking";
    if (name) expression = reading ? "searching" : "working";
    if (focused) expression = "focused";
    active()?.activity(expression);
  }
  function start() {
    if (!active()) return;
    options.cancelReaction();
    if (busy) return;
    busy = true;
    focused = false;
    clearTimers();
    working();
    later(15000, () => { focused = true; working(); });
  }
  function rest(listening = false) {
    clearTimers();
    busy = false;
    focused = false;
    tools.clear();
    options.getPlayer()?.activity(listening ? "listening" : "idle");
    if (listening) later(10000, () => active()?.activity("idle"));
    later(60000, () => active()?.activity("sleepy"));
  }
  function stop() {
    clearTimers();
    options.cancelReaction();
    options.getPlayer()?.stop();
    busy = false;
    focused = false;
    tools.clear();
    userText = "";
    assistantText = "";
  }

  pi.on("before_agent_start", (event) => {
    if (!active()) return;
    userText = event.messageType === "user" ? visibleText(event.prompt) : "";
    assistantText = "";
    start();
  });
  pi.on("agent_start", start);
  pi.on("message_update", (event) => {
    if (!active() || event.message.role !== "assistant" || tools.size) return;
    const type = event.assistantMessageEvent.type;
    if (type === "text_delta") active()?.activity("working");
    else if (type === "thinking_start" || type === "thinking_delta") working();
  });
  pi.on("message_end", (event) => {
    if (!active()) return;
    if (event.message.role === "user") {
      options.cancelReaction();
      userText = visibleText(event.message.content);
      assistantText = "";
    } else if (event.message.role === "assistant") {
      assistantText = event.message.stopReason === "stop" ? visibleText(event.message.content) : "";
    }
  });
  pi.on("tool_execution_start", (event) => {
    if (!active()) return;
    options.cancelReaction();
    tools.set(event.toolCallId, event.toolName);
    working();
  });
  pi.on("tool_execution_end", (event) => {
    if (!active()) return;
    tools.delete(event.toolCallId);
    working();
    if (event.isError) {
      options.cancelReaction();
      active()?.react("error", true);
    }
  });
  pi.on("agent_settled", () => {
    if (!active()) return;
    rest(true);
    if (assistantText) options.requestReaction({ userText, assistantText });
    assistantText = "";
  });
  pi.on("session_before_compact", () => {
    if (!active()) return;
    clearTimers();
    options.cancelReaction();
    active()?.activity("dizzy");
  });
  pi.on("session_compact", () => {
    if (!active()) return;
    if (busy) working();
    else rest();
  });
  pi.on("session_tree", () => {
    stop();
    if (active()) rest();
  });
  return {
    stop,
    wake() {
      if (busy || tools.size || !active()?.wake()) return;
      options.cancelReaction();
      rest(true);
    },
    reset() {
      stop();
      // Visibility commits its visible flag after the show callback returns.
      if (options.getPlayer()) rest();
    },
  };
}
