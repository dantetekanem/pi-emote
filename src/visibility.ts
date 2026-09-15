import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

export function registerVisibilityCommand(pi: ExtensionAPI, visibility: WidgetVisibility) {
  pi.registerCommand("pi-emote-toggle", {
    description: "Show or hide the pi-emote widget",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;

      const visible = visibility.toggle();
      pi.appendEntry("pi-emote-visibility", { visible });
      ctx.ui.notify(`[pi-emote] Widget ${visible ? "shown" : "hidden"}.`, "info");
    },
  });
}
