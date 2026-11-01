import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./theme.js") return nextResolve("./theme.ts", context);
    return nextResolve(specifier, context);
  },
});
const { loadLayeredConfig } = await import("../src/config.ts");
hooks.deregister();

const cases = [
  { name: "no consent by default", enabled: false },
  { name: "project cannot opt in", project: { enabled: true }, enabled: false },
  { name: "extension cannot opt in", ext: { enabled: true }, enabled: false },
  {
    name: "project cannot override user refusal",
    user: { enabled: false },
    project: { enabled: true },
    enabled: false,
  },
  { name: "truthy user value is not consent", user: { enabled: "true" }, enabled: false },
  { name: "user can opt in to the default classifier", user: { enabled: true }, enabled: true },
  {
    name: "project can disable reactions",
    user: { enabled: true },
    project: { enabled: false },
    enabled: false,
  },
  {
    name: "project cannot redirect the default classifier",
    user: { enabled: true },
    project: { classifier: "other/private" },
    enabled: false,
  },
  {
    name: "project cannot redirect a user classifier",
    user: { enabled: true, classifier: "user/chosen" },
    project: { classifier: "other/private" },
    enabled: false,
    classifier: "user/chosen",
  },
  {
    name: "user classifier overrides the extension default",
    ext: { classifier: "ext/default" },
    user: { enabled: true, classifier: "user/chosen" },
    project: { classifier: "user/chosen" },
    enabled: true,
    classifier: "user/chosen",
  },
];

for (const scenario of cases) {
  test(scenario.name, t => {
    const root = mkdtempSync(join(tmpdir(), "emote-consent-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const home = join(root, "home");
    t.mock.property(process, "env", { ...process.env, HOME: home });
    const ext = join(root, "ext");
    const cwd = join(root, "project");
    const layers = [
      [ext, scenario.ext],
      [join(home, ".pi/agent/extensions/pi-emote"), scenario.user],
      [join(cwd, ".pi/extensions/pi-emote"), scenario.project],
    ];
    for (const [dir, reactions] of layers) {
      mkdirSync(dir, { recursive: true });
      if (reactions) writeFileSync(join(dir, "config.json"), JSON.stringify({ reactions }));
    }

    const { config } = loadLayeredConfig(ext, cwd);

    assert.equal(config.reactions.enabled, scenario.enabled);
    assert.equal(config.reactions.classifier, scenario.classifier ?? "typesafe/jev-latest");
  });
}
