import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

interface VisibilityActions {
  show(): void;
  hide(): void;
}

export interface WidgetVisibility {
  isVisible(): boolean;
  show(): boolean;
  hide(): boolean;
  toggle(): boolean;
}

export function createWidgetVisibility(actions: VisibilityActions): WidgetVisibility {
  let visible = false;

  const show = () => {
    if (visible) return true;
    actions.show();
    visible = true;
    return visible;
  };

  const hide = () => {
    if (!visible) return false;
    actions.hide();
    visible = false;
    return visible;
  };

  return {
    isVisible: () => visible,
    show,
    hide,
    toggle: () => visible ? hide() : show(),
  };
}

export function restoreWidgetVisibility(
  visibility: WidgetVisibility,
  entries: readonly { type: string; customType?: string; data?: unknown }[],
): boolean {
  let visible = true;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== "pi-emote-visibility") continue;
    const data = entry.data;
    if (data && typeof data === "object" &&
        "visible" in data && typeof data.visible === "boolean") {
      visible = data.visible;
    }
  }
  return visible ? visibility.show() : visibility.hide();
}

export function registerEmoteCommand(
  pi: ExtensionAPI,
  visibility: WidgetVisibility,
  switchSet: (ctx: ExtensionCommandContext) => void | Promise<void>,
) {
  pi.registerCommand("pi-emote", {
    description: "Select an emote set or show/hide the widget: /pi-emote switch|toggle",
    getArgumentCompletions: (prefix) => {
      const matches = ["switch", "toggle"].filter((name) => name.startsWith(prefix));
      return matches.length ? matches.map((name) => ({ value: name, label: name })) : null;
    },
    handler: async (args, ctx) => {
      if (!ctx.hasUI || ctx.mode !== "tui") return;
      switch (args.trim()) {
        case "switch":
          await switchSet(ctx);
          return;
        case "toggle": {
          const visible = visibility.toggle();
          pi.appendEntry("pi-emote-visibility", { visible });
          ctx.ui.notify(`[pi-emote] Widget ${visible ? "shown" : "hidden"}.`, "info");
          return;
        }
        default:
          ctx.ui.notify("Usage: /pi-emote switch|toggle", "info");
      }
    },
  });
}
