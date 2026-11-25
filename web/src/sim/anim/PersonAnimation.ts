import { anmDurationMs, anmFramePosition, type Anm } from "../../formats/Anm.ts";
import type { MshBone } from "../../formats/Msh.ts";
import type { Seq } from "../../formats/Seq.ts";
import { poseBones, skinTransforms, type SkinTransform } from "./AutoAnimation.ts";

/**
 * What a standing person plays (docs/PEOPLE.md, "Animation").
 *
 * The save does not store a person's current animation. The game gives a person who is inside a room a *room scene*, `ai_<room>_<index>.flm` (the room is
 * `InRoomName`, the index `InRoomIdx`; in one save a pre-production crew member's saved facing equals the scene's first character's exactly), whose first
 * animation box names what they do: a single clip (`idle_male.anm`) or a `.seq` playlist (`staff_idle.seq`). That is the plan used here.
 */
export interface AnimationPlan {
  /** Where the plan came from, for the dev menu: `scene.flm: clip` or `fallback: why`. */
  source: string;
  /** A single clip to loop (when `seq` is null). */
  clip: string;
  /** A playlist to pick from at random (the first animation box named a `.seq`). */
  seq: Seq | null;
}

/** The clip that stands in when a person has no room scene (they are outside, or the room has no scene file). */
export const FALLBACK_CLIP = "idle_male.anm";

/**
 * Plays a plan on a skeleton: keeps the current clip and its time, and chooses the next clip when one ends. The time is whatever the caller feeds `step`
 * (the web app feeds game time scaled by the game speed, so a paused game freezes people; [guess] the original steps character animation inside the simulation, the
 * auto-animated flags it steps by frame time, `AutoAnimation.ts`).
 *
 * Playlist rule [guess]: a `.seq` with a base idle plays the idle one to three times between fidgets, then a fidget chosen by the file's weights; a `.seq` without
 * one just picks by weight each time. The weights come from the file; the one-to-three repeat is not read from anything.
 */
export class PersonAnimator {
  private readonly skeleton: MshBone[];
  private readonly clips: Map<string, Anm>;
  private readonly plan: AnimationPlan;
  private readonly random: () => number;
  private current: string;
  private timeMs = 0;
  /** Base-idle plays still to go before the next fidget. */
  private idleLeft = 0;
  /** A clip that overrides the plan while it is set (the gait clip while walking); null returns to the plan. */
  private override: string | null = null;

  constructor(skeleton: MshBone[], clips: Map<string, Anm>, plan: AnimationPlan, random: () => number = Math.random) {
    this.skeleton = skeleton;
    this.clips = clips;
    this.plan = plan;
    this.random = random;
    this.current = plan.seq ? this.pickNext(true) : plan.clip;
    // start at a random point of the first clip so a room of people does not move in lock step
    const clip = clips.get(this.current);
    if (clip) this.timeMs = this.random() * anmDurationMs(clip);
  }

  /** The clip playing now (a file name). */
  get clipName(): string { return this.override ?? this.current; }

  /** Play `name` (looping) in place of the plan, or return to the plan with null. A change restarts the clip. */
  setOverride(name: string | null): void {
    if (name === this.override) return;
    this.override = name && this.clips.has(name) ? name : null;
    if (this.override) this.timeMs = 0;
  }

  /** Advance by `dtMs` and return the skinning transforms of the pose now, or null when the clip is unknown (the person keeps their last pose). */
  step(dtMs: number): SkinTransform[] | null {
    if (this.override) {
      const walk = this.clips.get(this.override)!;
      this.timeMs = (this.timeMs + Math.max(0, dtMs)) % anmDurationMs(walk);
      return skinTransforms(this.skeleton, poseBones(this.skeleton, walk, anmFramePosition(walk, this.timeMs), "absolute"));
    }
    let clip = this.clips.get(this.current);
    if (!clip) return null;
    this.timeMs += Math.max(0, dtMs);
    let dur = anmDurationMs(clip);
    while (this.timeMs >= dur) {
      this.timeMs -= dur;
      this.current = this.plan.seq ? this.pickNext(false) : this.plan.clip;
      clip = this.clips.get(this.current) ?? clip;
      dur = anmDurationMs(clip);
    }
    return skinTransforms(this.skeleton, poseBones(this.skeleton, clip, anmFramePosition(clip, this.timeMs), "absolute"));
  }

  /** The next clip of the playlist. */
  private pickNext(first: boolean): string {
    const seq = this.plan.seq!;
    if (seq.baseIdle && this.clips.has(seq.baseIdle)) {
      if (first) { this.idleLeft = 1 + Math.floor(this.random() * 3); return seq.baseIdle; }
      if (this.idleLeft > 0) { this.idleLeft--; return seq.baseIdle; }
      this.idleLeft = 1 + Math.floor(this.random() * 3);
    }
    const choices = seq.clips.map((name, i) => ({ name, w: this.clips.has(name) ? seq.weights[i] ?? 1 : 0 }));
    const total = choices.reduce((n, c) => n + c.w, 0);
    if (total <= 0) return seq.baseIdle ?? this.plan.clip;
    let r = this.random() * total;
    for (const c of choices) { r -= c.w; if (r < 0) return c.name; }
    return choices[choices.length - 1]!.name;
  }
}
