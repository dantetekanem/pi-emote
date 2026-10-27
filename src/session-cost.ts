interface CostRequest {
  sessionId: string;
  result?: { usd: number; complete: boolean };
}

/** Ask the optional teams extension for its current total; never rewrite native usage. */
export function formatSessionCost(
  events: { emit(name: string, data: CostRequest): void } | undefined,
  sessionId: string,
  nativeCost: number,
): string {
  const request: CostRequest = { sessionId };
  try { events?.emit("pi-extended-teams:cost-request", request); } catch { /* Keep native fallback. */ }
  const cost = request.result;
  if (!cost || !Number.isFinite(cost.usd) || cost.usd < 0 || typeof cost.complete !== "boolean") {
    return `$${nativeCost.toFixed(3)}`;
  }
  return `$${cost.usd.toFixed(3)}${cost.complete ? "" : " (incomplete)"}`;
}
