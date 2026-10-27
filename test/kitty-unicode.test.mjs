import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Geometry is incidental; exercise the real renderer, PNG loading and tmux wrapper.
const geometryStub = `
  export const getCellDimensions = () => ({ widthPx: 10, heightPx: 20 });
  export const getImageDimensions = () => ({ widthPx: 510, heightPx: 510 });
  export const calculateImageRows = () => 4;
`;
const sourceRoot = new URL("../src/", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@earendil-works/pi-tui") {
      return { url: `data:text/javascript,${encodeURIComponent(geometryStub)}`, shortCircuit: true };
    }
    if (context.parentURL?.startsWith(sourceRoot) && specifier.startsWith("./") && specifier.endsWith(".js")) {
      return nextResolve(specifier.replace(/\.js$/, ".ts"), context);
    }
    return nextResolve(specifier, context);
  },
});
const { KittyUnicodeRenderer, TmuxKittyUnicodeRenderer } = await import("../src/render_tmux_kitty_unicode.ts");
hooks.deregister();

for (const Renderer of [KittyUnicodeRenderer, TmuxKittyUnicodeRenderer]) {
  test(`${Renderer.name} synchronizes every chunk of a same-ID frame replacement`, (t) => {
    const renderer = new Renderer(8);
    renderer.loadFrames(fileURLToPath(new URL("../emotes/default/", import.meta.url)), "");
    const writes = [];
    let renders = 0;
    renderer.setTui({ requestRender() { renders++; } });
    const stdout = t.mock.method(process.stdout, "write", (data) => {
      writes.push(data);
      return true;
    });
    try {
      assert.equal(renderer.showFrame("idle", "idle.png"), true);
      const initialGrid = renderer.getRenderedFrame();
      assert.equal(renderer.showFrame("idle", "idle_blink.png"), true);
      assert.deepEqual(renderer.getRenderedFrame(), initialGrid);
      assert.equal(renders, 2);
      assert.equal(writes.length, 2);

      const imageIds = [];
      for (let output of writes) {
        if (Renderer === TmuxKittyUnicodeRenderer) {
          assert.ok(output.startsWith("\x1bPtmux;"));
          assert.ok(output.endsWith("\x1b\\"));
          output = output.slice(7, -2).replaceAll("\x1b\x1b", "\x1b");
        }
        assert.ok(output.startsWith("\x1b[?2026h"), "suspend rendering before the first chunk deletes the old image");
        assert.ok(output.endsWith("\x1b[?2026l"), "resume rendering after the final chunk restores the image");
        const upload = output.slice(8, -8);
        const chunks = [...upload.matchAll(/\x1b_G([^;]+);([A-Za-z0-9+/=]*)\x1b\\/g)];
        assert.ok(chunks.length > 1, "fixture must exercise a split upload");
        assert.equal(chunks.map(([sequence]) => sequence).join(""), upload);
        assert.ok(chunks.slice(0, -1).every(([, params]) => params.endsWith("m=1")));
        assert.equal(chunks.at(-1)[1], "m=0");
        imageIds.push(chunks[0][1].match(/\bi=(\d+)/)[1]);
      }
      assert.equal(imageIds[0], imageIds[1]);

      renderer.showFrame("idle", "idle_blink.png");
      assert.equal(writes.length, 2, "unchanged frames still reuse the uploaded image");
      renderer.dispose();
      let deletion = writes.at(-1);
      if (Renderer === TmuxKittyUnicodeRenderer) {
        deletion = deletion.slice(7, -2).replaceAll("\x1b\x1b", "\x1b");
      }
      assert.equal(deletion, `\x1b_Ga=d,d=I,i=${imageIds[0]},q=2\x1b\\`);
      assert.equal(renderer.getRenderedFrame(), null);
    } finally {
      stdout.mock.restore();
    }
  });
}
