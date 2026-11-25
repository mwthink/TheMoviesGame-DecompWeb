import { FlmType, type Flm, type FlmObject } from "./Flm.ts";

/**
 * A `.flm` scene as a graph a player can walk (docs/FLM_FORMAT.md 4 and 5; the box layouts are read from `FlmBoxHeader_Read`, `FSBox_Deserialize` and the constructors of the box classes).
 * Built from the raw object words of `parseFlm`; only what the AI interaction scenes use is decoded (anim, move-to, choice, settings and plain boxes), the camera and prop objects are skipped.
 * Pure data: no engine or browser API.
 */

/** Where an actor goes when a box ends: `next` is a box id or -1 (the actor is released), `slot` the actor slot of the next box. */
export interface SceneLink { next: number; slot: number; }

export interface SceneBox {
  id: number;
  kind: "box" | "anim" | "move" | "choice" | "settings" | "pass";
  /** The box's place in the scene's own frame: x, y, z and heading. */
  x: number; y: number; z: number; yaw: number;
  /** One link per actor slot. */
  links: SceneLink[];
  /** `box`: how long it waits, in scene steps (1/30 s); 0 passes straight through. */
  steps: number;
  /** `anim`: the animation file (lower case). `move`: the walk animation, or null. */
  clip: string | null;
  /** `move`: the path (start, two control points, end), its length, and whether it is a straight line. */
  path: { p: [number, number, number][]; length: number; straight: boolean } | null;
  /** `choice`: the selector (string index of a channel, or -1 random, -2 compare, -3 female, -4 prop type), the branches (one link list per branch) and the weights. */
  selector: number;
  branches: SceneLink[][];
  weights: number[];
  /** `settings`: the channel it sets (index into the channels, the first strings), how (0 set, 1 add, 2 random up to the value) and to what; null when it sets none. */
  channelSet: { channel: number; mode: number; value: number } | null;
}

export interface SceneActor {
  /** The box the actor starts on, and the place and heading the scene gives it there. */
  startBox: number;
  x: number; y: number; z: number; yaw: number;
}

export interface SceneGraph {
  strings: string[];
  channelCount: number;
  /** The channels' names (the first `channelCount` strings) and their initial values (0 unless the file gives one). */
  channelNames: string[];
  channelInitial: number[];
  boxes: Map<number, SceneBox>;
  actors: SceneActor[];
}

const f32 = (w: number): number => new Float32Array(new Int32Array([w]).buffer)[0]!;

function triples(o: FlmObject, count: number, start: number): SceneLink[] {
  const out: SceneLink[] = [];
  for (let k = 0; k < count; k++) out.push({ next: o.words[start + 3 * k]!, slot: o.words[start + 3 * k + 1]! });
  return out;
}

/** Decode the boxes and actors of a parsed scene. */
export function buildSceneGraph(flm: Flm): SceneGraph {
  const boxes = new Map<number, SceneBox>();
  const actors: SceneActor[] = [];
  for (const o of flm.objects) {
    const w = o.words;
    if (o.type === FlmType.Character) {
      actors.push({ startBox: w[5]!, x: f32(w[16]!), y: f32(w[17]!), z: f32(w[18]!), yaw: f32(w[19]!) });
      continue;
    }
    if (o.type !== FlmType.Box && o.type !== FlmType.AnimBox && o.type !== FlmType.MoveToBox && o.type !== FlmType.ChoiceBox && o.type !== FlmType.SettingsBox
      && o.type !== FlmType.CamBox && o.type !== FlmType.CSettingsBox2) continue;
    const b0 = w[8]! & 0xff, listA = w[9]! & 0xff, listB = w[10]! & 0xff;
    const box: SceneBox = {
      id: w[2]!, kind: "pass", x: f32(w[4]!), y: f32(w[5]!), z: f32(w[6]!), yaw: f32(w[7]!), links: [], steps: 0, clip: null, path: null, selector: 0, branches: [], weights: [], channelSet: null,
    };
    const tail = w.length - listA - listB - 3 * b0; // the trailer triples, one per actor slot, sit before the two link lists
    switch (o.type) {
      case FlmType.Box:
        box.kind = "box";
        box.steps = w[11]!;
        box.links = triples(o, b0, tail);
        break;
      case FlmType.AnimBox:
        box.kind = "anim";
        box.clip = (flm.strings[w[15]!] ?? "").toLowerCase() || null;
        box.links = triples(o, b0, tail);
        break;
      case FlmType.MoveToBox: {
        box.kind = "move";
        box.path = { p: [[f32(w[15]!), f32(w[16]!), f32(w[17]!)], [f32(w[18]!), f32(w[19]!), f32(w[20]!)], [f32(w[21]!), f32(w[22]!), f32(w[23]!)], [f32(w[24]!), f32(w[25]!), f32(w[26]!)]], length: f32(w[27]!), straight: (w[29]! & 1) !== 0 };
        box.clip = w[28]! >= 0 ? (flm.strings[w[28]!] ?? "").toLowerCase() || null : null;
        box.links = triples(o, b0, tail);
        break;
      }
      case FlmType.ChoiceBox: {
        box.kind = "choice";
        box.selector = w[15]!;
        const n = w[16]! & 0xff;
        box.links = triples(o, b0, 19);
        // the branches and their weights are the very end of the record: n groups of b0 triples, then n weights
        const groupsStart = w.length - n * (3 * b0 + 1);
        for (let i = 0; i < n; i++) box.branches.push(triples(o, b0, groupsStart + i * 3 * b0));
        for (let i = 0; i < n; i++) box.weights.push(f32(w[w.length - n + i]!));
        break;
      }
      case FlmType.SettingsBox: {
        box.kind = "settings";
        const idx = w[22]! & 0xffff;
        if (idx !== 0xffff && idx < flm.channelCount) box.channelSet = { channel: idx, mode: (w[22]! >>> 16) & 0xffff, value: f32(w[23]!) };
        box.links = triples(o, b0, tail);
        break;
      }
      default:
        box.links = triples(o, b0, tail); // camera and settings-2 boxes do nothing a character shows: the actor passes through
    }
    boxes.set(box.id, box);
  }
  const channelNames = flm.strings.slice(0, flm.channelCount);
  const channelInitial = channelNames.map((_, i) => {
    const v = flm.channelDefaults ? f32(flm.channelDefaults[i]!) : 0;
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0;
  });
  return { strings: flm.strings, channelCount: flm.channelCount, channelNames, channelInitial, boxes, actors };
}
