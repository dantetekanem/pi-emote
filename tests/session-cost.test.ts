import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { formatSessionCost } from "../src/session-cost.ts";

test("uses combined cost, preserves incomplete totals, and falls back without a provider", () => {
  const events = new EventEmitter();
  const nativeCost = 1.25;
  assert.equal(formatSessionCost(events, "root", nativeCost), "$1.250");
  let result = { usd: 3.5, complete: true };
  const provider = (request: any) => {
    assert.equal(request.sessionId, "root");
    request.result = result;
  };
  events.on("pi-extended-teams:cost-request", provider);
  assert.equal(formatSessionCost(events, "root", nativeCost), "$3.500");
  result = { usd: 4, complete: false };
  assert.equal(formatSessionCost(events, "root", nativeCost), "$4.000 (incomplete)");
  result = { usd: 0, complete: true };
  assert.equal(formatSessionCost(events, "root", nativeCost), "$0.000");
  events.off("pi-extended-teams:cost-request", provider);
  assert.equal(formatSessionCost(events, "root", nativeCost), "$1.250");
});
