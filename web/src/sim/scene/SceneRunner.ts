import type { SceneBox, SceneGraph } from "../../formats/FlmScene.ts";

/**
 * Plays an AI interaction scene for one actor (docs/FLM_FORMAT.md 5 and 5b, docs/DESIRES.md "Scenes"): the actor stands on a box, the box runs, and on finishing the actor moves to the box's
 * next link. An animation box plays its clip for the clip's length, a move box walks its path, a plain box waits, a settings box sets a channel, a choice box picks a branch. Channels are the
 * scene's named variables, always between 0 and 1; a channel named like a slider set that is set to 1 fires that set once and clears (`TMActivityManager_DispatchAiChannelEvents`).
 * Pure logic: no engine or browser API.
 */

export interface SceneOptions {
  /** The actor's costume is female (the `-3` choice). */
  female: boolean;
  random: () => number;
  /** How long an animation lasts, ms, or undefined when it is not loaded. */
  clipMs: (clip: string) => number | undefined;
  /** How fast a walk animation moves, units per second, or undefined. */
  walkSpeed: (clip: string | null) => number | undefined;
  /** The names of the slider sets of the prop: a channel with one of these names fires it. */
  sliderSets: ReadonlySet<string>;
  /** Values for channels by name before the first step (`ai_male`, `ai_star`, `ai_drunk`, ...). */
  channels?: Record<string, number>;
}

/** The scene runs 30 steps a second (docs/FLM_FORMAT.md 5e, measured). */
export const SCENE_STEPS_PER_SECOND = 30;
/** A clip that is not loaded is held for this long. [guess] */
const UNKNOWN_CLIP_SECONDS = 1;
/** Boxes that finish at once are followed up to this many times in one step (a loop with no wait would otherwise never return). */
const INSTANT_LIMIT = 400;

/** Round to the nearest integer, halves to the even one (the FPU's `FIST`, `CRT_RoundToInt64`). */
function roundHalfEven(v: number): number {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

export class SceneRunner {
  private readonly graph: SceneGraph;
  private readonly opts: SceneOptions;
  private readonly channels: number[];
  private box: SceneBox | null;
  private elapsed = 0;
  private duration = 0;
  private events: string[] = [];
  /** The clip the actor plays now (a file name), or null. */
  clip: string | null = null;
  /** Where the actor is, in the scene's own frame: position and heading. */
  place: { x: number; y: number; yaw: number };
  /** The place and heading the scene gives the actor at the start (the scene is anchored to the person's own position and heading there). */
  readonly start: { x: number; y: number; yaw: number };
  finished: boolean;

  constructor(graph: SceneGraph, opts: SceneOptions) {
    this.graph = graph;
    this.opts = opts;
    this.channels = [...graph.channelInitial];
    for (const [name, v] of Object.entries(opts.channels ?? {})) this.setChannel(name, v);
    const actor = graph.actors[0];
    this.start = actor ? { x: actor.x, y: actor.y, yaw: actor.yaw } : { x: 0, y: 0, yaw: 0 };
    this.place = { ...this.start };
    this.box = actor ? graph.boxes.get(actor.startBox) ?? null : null;
    this.finished = this.box === null;
    if (this.box) this.enter(this.box);
  }

  /** The value of a channel (0 when the scene has none of that name). */
  channel(name: string): number {
    const i = this.graph.channelNames.indexOf(name);
    return i < 0 ? 0 : this.channels[i]!;
  }

  /** Write a channel by name, clamped to 0..1 (`SceneChannel_SetValue`); a scene without that channel ignores it. */
  setChannel(name: string, value: number): void {
    const i = this.graph.channelNames.indexOf(name);
    if (i >= 0) this.channels[i] = clamp01(value);
  }

  /** The slider sets fired since the last call, in order. */
  takeEvents(): string[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Advance by `dt` seconds. */
  step(dt: number): void {
    let left = Math.max(0, dt);
    let instant = 0;
    while (this.box && instant < INSTANT_LIMIT) {
      const remaining = this.duration - this.elapsed;
      if (remaining > 1e-9) {
        if (left <= 1e-9) break;
        const take = Math.min(left, remaining);
        this.elapsed += take;
        left -= take;
        if (this.box.kind === "move") this.placeOnPath(this.box);
        if (this.duration - this.elapsed > 1e-9) break;
      }
      // the box is done: move on (a box that is not timed is done the moment it is entered)
      instant++;
      this.leave(this.box);
    }
    this.dispatch();
  }

  /** `DispatchAiChannelEvents`: a channel named like a slider set that is at 1 fires the set and is cleared. */
  private dispatch(): void {
    for (let i = 0; i < this.graph.channelNames.length; i++) {
      if (this.channels[i] === 1 && this.opts.sliderSets.has(this.graph.channelNames[i]!)) {
        this.events.push(this.graph.channelNames[i]!);
        this.channels[i] = 0;
      }
    }
  }

  /** Start a box: place the actor, set its clip, and work out how long it runs. */
  private enter(box: SceneBox): void {
    this.elapsed = 0;
    this.duration = 0;
    switch (box.kind) {
      case "box":
        this.place = { x: box.x, y: box.y, yaw: box.yaw };
        this.duration = Math.max(0, box.steps) / SCENE_STEPS_PER_SECOND; // -1 waits for a signal from another box: with one actor nothing signals, so it passes
        break;
      case "anim": {
        this.place = { x: box.x, y: box.y, yaw: box.yaw };
        this.clip = box.clip;
        const ms = box.clip ? this.opts.clipMs(box.clip) : undefined;
        this.duration = ms !== undefined ? ms / 1000 : UNKNOWN_CLIP_SECONDS;
        break;
      }
      case "move": {
        this.clip = box.clip;
        const speed = this.opts.walkSpeed(box.clip) ?? 1.67; // [guess] the game's move duration is not read beyond its clip-length clamp
        this.duration = box.path && box.path.length > 0 ? box.path.length / speed : 0;
        this.placeOnPath(box);
        break;
      }
      case "choice":
        break;
      case "settings":
        if (box.channelSet) this.applyChannelSet(box.channelSet);
        break;
      default:
        break;
    }
  }

  /** `SceneCommand_ApplyChannelSet`: set the channel, add to it, or set it to a random value from 0 to the value (a value of 0 meaning 1). Then clamped to 0..1. */
  private applyChannelSet(c: { channel: number; mode: number; value: number }): void {
    let v = this.channels[c.channel]!;
    if (c.mode === 0) v = c.value;
    else if (c.mode === 1) v = v + c.value;
    else if (c.mode === 2) v = this.opts.random() * (c.value === 0 ? 1 : c.value);
    this.channels[c.channel] = clamp01(v);
  }

  /** The actor's place along a move box's path at the elapsed fraction: a cubic curve through its control points, or a straight line. */
  private placeOnPath(box: SceneBox): void {
    const path = box.path;
    if (!path) return;
    const t = this.duration > 0 ? Math.min(1, this.elapsed / this.duration) : 1;
    const [p0, p1, p2, p3] = path.p as [number, number, number][];
    let x: number, y: number, dx: number, dy: number;
    if (path.straight) {
      x = p0![0] + (p3![0] - p0![0]) * t; y = p0![1] + (p3![1] - p0![1]) * t;
      dx = p3![0] - p0![0]; dy = p3![1] - p0![1];
    } else {
      const u = 1 - t;
      x = u * u * u * p0![0] + 3 * u * u * t * p1![0] + 3 * u * t * t * p2![0] + t * t * t * p3![0];
      y = u * u * u * p0![1] + 3 * u * u * t * p1![1] + 3 * u * t * t * p2![1] + t * t * t * p3![1];
      dx = 3 * u * u * (p1![0] - p0![0]) + 6 * u * t * (p2![0] - p1![0]) + 3 * t * t * (p3![0] - p2![0]);
      dy = 3 * u * u * (p1![1] - p0![1]) + 6 * u * t * (p2![1] - p1![1]) + 3 * t * t * (p3![1] - p2![1]);
    }
    const yaw = Math.hypot(dx, dy) > 1e-6 ? Math.atan2(dy, dx) : this.place.yaw;
    this.place = { x, y, yaw };
  }

  /** A choice box's branch (`FSChoiceBox_Execute`). */
  private pick(box: SceneBox): number {
    const n = box.branches.length;
    if (n === 0) return 0;
    if (box.selector === -1) {
      const r = this.opts.random();
      if (n < 2) return 0;
      for (let i = 0; i < n; i++) if (r <= box.weights[i]!) return i;
      return Math.floor(this.opts.random() * n); // no weight reached: a random branch (`FUN_009732D0`)
    }
    if (box.selector === -2) return 1; // compare two channels: not read; "equal"
    if (box.selector === -3) return this.opts.female ? Math.min(1, n - 1) : 0;
    if (box.selector === -4) return 0;
    // a channel read: the value, 0 to 1, times the number of branches, rounded and kept under n
    const name = this.graph.channelNames[box.selector];
    const v = name === undefined ? 0 : this.channels[box.selector]!;
    return Math.max(0, Math.min(n - 1, roundHalfEven(clamp01(v) * n)));
  }

  /** The box is done: go to its next link. */
  private leave(box: SceneBox): void {
    let next: number | undefined;
    if (box.kind === "choice") next = box.branches[this.pick(box)]?.[0]?.next;
    else next = box.links[0]?.next;
    const target = next !== undefined && next !== -1 ? this.graph.boxes.get(next) : undefined;
    if (!target) { this.box = null; this.finished = true; this.clip = null; return; }
    this.box = target;
    this.enter(target);
  }
}
