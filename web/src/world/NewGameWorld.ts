import type { PakIndex } from "../assets/Pak.ts";
import { Ini } from "../formats/Ini.ts";
import { parseLandscapeFile } from "../formats/Jad.ts";
import type { Strings } from "../formats/Lhts.ts";
import { newGameLayoutName, newGameSave, parseStartConfig, type NewGameProfile } from "../sim/sandbox/NewGame.ts";
import { parseStartingLayout } from "../sim/sandbox/StartingLayout.ts";
import { loadWorldData, type WorldData } from "./WorldData.ts";

/** A new game's world: the start year and money from global.ini, then `data\savedefaults\<year>.ini` and `.lnd` drawn like a loaded save (docs/NEW_GAME.md). */
export async function loadNewGameWorld(
  pak: PakIndex, profile: NewGameProfile, progress: (text: string) => void = () => {}, strings: Strings | null = null,
): Promise<WorldData & { profile: NewGameProfile }> {
  const text = async (name: string, dir: string) => {
    const bytes = await pak.readByName(name, { dir });
    return bytes ? new TextDecoder().decode(bytes) : null;
  };
  const global = await text("global.ini", "data\\");
  const start = parseStartConfig(Ini.parse(global ?? ""));
  const layoutName = newGameLayoutName(start.year).split("/")[1]!;
  progress("Starting layout");
  const iniText = await text(`${layoutName}.ini`, "data\\savedefaults\\");
  if (iniText === null) throw new Error(`data\\savedefaults\\${layoutName}.ini not found`);
  const lnd = await pak.readByName(`${layoutName}.lnd`, { dir: "data\\savedefaults\\" });
  const landscape = lnd ? parseLandscapeFile(lnd) : null;
  const world = await loadWorldData(pak, newGameSave(parseStartingLayout(Ini.parse(iniText)), landscape, start), progress, strings);
  if (!lnd) world.warnings.push(`data\\savedefaults\\${layoutName}.lnd not found: no terrain`);
  return { ...world, profile };
}
