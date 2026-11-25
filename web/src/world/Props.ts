import type { PakIndex } from "../assets/Pak.ts";
import { parseDesires, type DesireDef } from "../sim/ai/Desires.ts";
import { PropExplainer, parseExplainer, parsePlacedExplainers, type ExplainerDef } from "../sim/ai/Explainers.ts";
import { parseFlm } from "../formats/Flm.ts";
import { buildSceneGraph, type SceneGraph } from "../formats/FlmScene.ts";
import { parseAnm, type Anm } from "../formats/Anm.ts";
import { clipFits } from "../sim/anim/AutoAnimation.ts";
import type { MshBone } from "../formats/Msh.ts";
import type { Placement } from "./WorldData.ts";

/**
 * What the placed props offer people (docs/DESIRES.md): for every placed facility and ornament, the explainers its ini lists (`[extra_info/explainer/<name>]`), each with the explainer
 * file's goal and costs, placed where the object stands. And the desire table. Files the archives lack are skipped with a warning.
 */
export interface PropData {
  props: PropExplainer[];
  desires: Map<string, DesireDef>;
  /** The interaction scenes the props name (`interaction = ai_sit_bench_0.flm`), by lower-case file name. */
  scenes: Map<string, SceneGraph>;
}

export async function loadPropData(pak: PakIndex, placements: readonly Placement[], warnings: string[]): Promise<PropData> {
  const text = async (name: string, dir: string, dirHint?: string): Promise<string | null> => {
    const f = pak.find(name, dir ? { dir } : dirHint ? { dirHint } : {});
    return f ? new TextDecoder("latin1").decode(await pak.read(f)) : null;
  };
  const desiresText = await text("desires.csv", "data\\rule\\");
  const desires = desiresText ? parseDesires(desiresText) : new Map<string, DesireDef>();
  if (!desiresText) warnings.push("data\\rule\\desires.csv not found: people have no desires");

  const explainerCache = new Map<string, ExplainerDef | null>();
  const defOf = async (name: string): Promise<ExplainerDef | null> => {
    const key = name.toLowerCase();
    if (!explainerCache.has(key)) {
      const t = await text(`${key}.ini`, "data\\explainers\\");
      explainerCache.set(key, t ? parseExplainer(key, t) : null);
    }
    return explainerCache.get(key)!;
  };
  const refsCache = new Map<string, ReturnType<typeof parsePlacedExplainers>>();
  const props: PropExplainer[] = [];
  for (const { asset } of placements) {
    if (!asset.source.startsWith("facility/") && !asset.source.startsWith("ornament/")) continue;
    let refs = refsCache.get(asset.source);
    if (!refs) {
      const slash = asset.source.indexOf("/");
      const t = await text(`${asset.source.slice(slash + 1)}.ini`, "", `\\${asset.source.slice(0, slash)}\\`);
      refs = t ? parsePlacedExplainers(t) : [];
      refsCache.set(asset.source, refs);
    }
    for (const ref of refs) {
      const def = await defOf(ref.name);
      if (def) props.push(new PropExplainer(def, ref, { x: asset.position[0], y: asset.position[1], yaw: asset.angle }));
    }
  }
  // the interaction scenes the props use
  const scenes = new Map<string, SceneGraph>();
  for (const p of props) {
    const name = p.def.interaction?.toLowerCase();
    if (!name || scenes.has(name)) continue;
    const f = pak.find(name, { dir: "data\\scene\\interactions\\" });
    if (!f) { warnings.push(`scene ${name} not found`); continue; }
    try { scenes.set(name, buildSceneGraph(parseFlm(await pak.read(f)))); } catch (e) { warnings.push(`scene ${name}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return { props, desires, scenes };
}

/**
 * Give the people who will use props the clips of the scenes those props play (the walk, the sit-down, the idles ...): each clip is parsed once and shared, and a person gets the ones that
 * fit their skeleton. Only the clips the scenes' animation and move boxes name are loaded.
 */
export async function loadSceneClips(
  pak: PakIndex, scenes: ReadonlyMap<string, SceneGraph>, people: readonly { skeleton: MshBone[]; clips: Map<string, Anm> }[],
): Promise<void> {
  const names = new Set<string>();
  for (const g of scenes.values()) for (const b of g.boxes.values()) if (b.clip) names.add(b.clip);
  const parsed = new Map<string, Anm | null>();
  for (const n of names) {
    const bytes = await pak.readByName(n, { dir: "data\\animations\\high\\" }) ?? await pak.readByName(n);
    parsed.set(n, bytes ? parseAnm(bytes) : null);
  }
  for (const person of people) {
    for (const [n, anm] of parsed) if (anm && !person.clips.has(n) && clipFits(person.skeleton, anm)) person.clips.set(n, anm);
  }
}
