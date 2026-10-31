import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

/** Observe edits after Pi handles input; never consume keys or forward draft text. */
export function watchTyping(
  ui: Pick<ExtensionUIContext, "onTerminalInput" | "getEditorText">,
  onEdit: () => void,
): () => void {
  let pending: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const unsubscribe = ui.onTerminalInput((): undefined => {
    if (disposed || pending) return;
    const before = ui.getEditorText();
    pending = setTimeout(() => {
      pending = undefined;
      if (!disposed && ui.getEditorText() !== before) onEdit();
    }, 0);
  });
  return () => {
    disposed = true;
    if (pending) clearTimeout(pending);
    pending = undefined;
    unsubscribe();
  };
}
