import { readFileSync } from "node:fs";
import type { ClassifierContext, ClassifierResult } from "@earendil-works/pi-ai";

const reactions = ["happy", "celebrating", "love", "wink", "surprised", "confused", "sad", "grumpy"] as const;
export type Reaction = typeof reactions[number];
export interface ReactionInput {
  userText: string;
  assistantText: string;
}
interface SelectorOptions {
  classify: (context: ClassifierContext, signal: AbortSignal) => Promise<ClassifierResult>;
  onReaction: (reaction: Reaction) => void;
  timeoutMs?: number;
  cooldownMs?: number;
}

let question: ClassifierContext["questions"][string] | undefined;
function reactionQuestion(): ClassifierContext["questions"][string] {
  if (!question) {
    const source = readFileSync(new URL("../prompts/reaction.md", import.meta.url), "utf8");
    const [instructions, choices] = source.split("\n## Choices\n");
    const criteria = JSON.parse(choices);
    question = { type: "choice", instructions: instructions.trim(), criteria };
  }
  return question;
}

function selectedReaction(result: ClassifierResult | undefined): Reaction | undefined {
  if (result?.stopReason !== "stop") return;
  const answer = result.answers?.reaction;
  if (answer?.type !== "choice") return;
  const choice = answer.choice;
  if (!reactions.some((reaction) => reaction === choice)) return;
  const probability = answer.probabilities?.[choice];
  // A modest display-only threshold, not a calibrated guarantee of correctness.
  if (!Number.isFinite(probability) || probability < 0.6 || probability > 1) return;
  return choice as Reaction;
}

/** Optional display-only judgments; the caller supplies provider/model resolution. */
export class ReactionSelector {
  private pending?: { cancel: () => void };
  private lastStarted = -Infinity;
  private readonly options: SelectorOptions;

  constructor(options: SelectorOptions) {
    this.options = options;
  }

  cancel(): void {
    const pending = this.pending;
    this.pending = undefined;
    pending?.cancel();
  }

  async request(input: ReactionInput): Promise<void> {
    // Even a skipped newer request invalidates the older conversation snapshot.
    this.cancel();
    try {
      const state = {
        userText: input.userText.slice(0, 1500),
        assistantText: input.assistantText.slice(0, 1500),
      };
      if (!state.userText.trim() && !state.assistantText.trim()) return;
      const now = Date.now();
      if (now - this.lastStarted < (this.options.cooldownMs ?? 15_000)) return;
      const context: ClassifierContext = {
        state,
        questions: { reaction: reactionQuestion() },
      };
      this.lastStarted = now;
      const controller = new AbortController();
      let cancel!: () => void;
      const cancelled = new Promise<undefined>((resolve) => {
        cancel = () => {
          clearTimeout(timer);
          controller.abort();
          resolve(undefined);
        };
      });
      const pending = { cancel };
      this.pending = pending;
      const timer = setTimeout(cancel, this.options.timeoutMs ?? 1500);
      try {
        const result = await Promise.race([
          this.options.classify(context, controller.signal),
          cancelled,
        ]);
        if (this.pending !== pending || controller.signal.aborted) return;
        const reaction = selectedReaction(result);
        if (reaction) this.options.onReaction(reaction);
      } finally {
        clearTimeout(timer);
        if (this.pending === pending) this.pending = undefined;
      }
    } catch {
      // Missing prompts, unavailable providers, malformed answers and UI teardown
      // must never interrupt the underlying agent or produce an unhandled rejection.
    }
  }
}
