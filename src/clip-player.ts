import type { AnimationClip, EmoteState } from "./types.js";

type ShowFrame = (state: EmoteState, file: string) => boolean;

/** Ordered image clips with one latest activity, not a queue of tool events. */
export class ClipPlayer {
  private clips = new Map<string, AnimationClip>();
  private show: ShowFrame;
  private minHoldMs: number;
  private reducedMotion: boolean;
  private current: string | null = null;
  private desired: string | null = null;
  private pendingReaction: string | null = null;
  private reacting = false;
  private startedAt = 0;
  private lastLoop = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(clips: Record<string, AnimationClip>, show: ShowFrame, options: { minHoldMs?: number; reducedMotion?: boolean } = {}) {
    this.show = show;
    const hold = options.minHoldMs;
    this.minHoldMs = typeof hold === "number" && Number.isFinite(hold) ? Math.min(10000, Math.max(2400, hold)) : 2400;
    this.reducedMotion = options.reducedMotion === true;
    for (const [name, clip] of Object.entries(clips)) {
      if (clip && ["hi", "idle", "think", "talk", "read", "write", "tool", "success", "failure", "compact"].includes(clip.state)
        && Number.isFinite(clip.frameMs) && clip.frameMs >= 40 && clip.frameMs <= 1000
        && Array.isArray(clip.frames) && clip.frames.length > 0 && clip.frames.length <= 300
        && clip.frames.length * clip.frameMs <= 10000
        && clip.frames.every((file) => typeof file === "string" && /^[^/\\]+\.png$/.test(file))) {
        this.clips.set(name, clip);
      }
    }
  }

  has(name: string): boolean {
    return this.clips.has(name);
  }

  activity(name: string): boolean {
    if (!this.has(name)) return false;
    if (this.desired !== name) this.pendingReaction = null;
    this.desired = name;
    if (!this.current) this.start(name, false);
    return true;
  }

  react(name: string, urgent = false): boolean {
    if (!this.has(name)) return false;
    if (this.current === name) return true;
    this.pendingReaction = name;
    if (!this.current || urgent) this.start(name, true);
    return true;
  }

  wake(): boolean {
    const resting = (name: string | null) => name !== null && ["idle", "sleepy", "listening"].includes(name);
    if (this.reacting || !resting(this.current) || !resting(this.desired) || !this.has("listening")) return false;
    this.desired = "listening";
    this.pendingReaction = null;
    if (this.current !== "listening") this.start("listening", false);
    return true;
  }

  refresh() {
    if (!this.current) return;
    const clip = this.clips.get(this.current)!;
    const index = this.reducedMotion ? 0 : Math.floor((Date.now() - this.startedAt) / clip.frameMs) % clip.frames.length;
    this.show(clip.state, clip.frames[index]);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.current = null;
    this.desired = null;
    this.pendingReaction = null;
    this.reacting = false;
  }

  private start(name: string, reaction: boolean) {
    if (this.timer) clearTimeout(this.timer);
    this.current = name;
    this.reacting = reaction;
    this.pendingReaction = null;
    this.startedAt = Date.now();
    this.lastLoop = 0;
    const clip = this.clips.get(name)!;
    this.show(clip.state, clip.frames[0]);
    this.schedule(clip);
  }

  private schedule(clip: AnimationClip) {
    const delay = this.reducedMotion ? this.minHoldMs : clip.frameMs;
    this.timer = setTimeout(() => this.tick(), delay);
  }

  private tick() {
    if (!this.current) return;
    const clip = this.clips.get(this.current)!;
    const elapsed = Date.now() - this.startedAt;
    const loop = Math.floor(elapsed / (clip.frames.length * clip.frameMs));
    const boundary = this.reducedMotion || loop > this.lastLoop;
    this.lastLoop = loop;
    if (elapsed >= this.minHoldMs && boundary) {
      if (this.pendingReaction) {
        this.start(this.pendingReaction, true);
        return;
      }
      if (this.desired && (this.reacting || this.desired !== this.current)) {
        this.start(this.desired, false);
        return;
      }
    }
    if (!this.reducedMotion) {
      const index = Math.floor(elapsed / clip.frameMs) % clip.frames.length;
      this.show(clip.state, clip.frames[index]);
    }
    this.schedule(clip);
  }
}
