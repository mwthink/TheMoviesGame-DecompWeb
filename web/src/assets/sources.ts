import { BlobSource, HttpSource, type ByteSource } from "./ByteSource.ts";

// Minimal typings for the File System Access API, which lib.dom does not include.
interface PermissionedHandle {
  queryPermission?(opts: { mode: "read" }): Promise<PermissionState>;
  requestPermission?(opts: { mode: "read" }): Promise<PermissionState>;
}
declare global {
  interface Window {
    showDirectoryPicker?(opts?: { mode?: "read"; id?: string }): Promise<FileSystemDirectoryHandle>;
  }
}

export const canPickDirectory = typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

/** The .pak files under a game folder: either the folder holds them, or `Data/pak` inside it does. Reads nothing yet; files are sliced on demand. */
export async function pakSourcesFromDirectory(dir: FileSystemDirectoryHandle): Promise<ByteSource[]> {
  const out: ByteSource[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".pak")) {
      out.push(new BlobSource(entry.name, await (entry as FileSystemFileHandle).getFile()));
    }
  }
  if (out.length) return out;
  for (const name of ["Data", "data", "pak"]) {
    try {
      const sub = await dir.getDirectoryHandle(name);
      const found = await pakSourcesFromDirectory(sub);
      if (found.length) return found;
    } catch {
      /* not there */
    }
  }
  return out;
}

/** The .pak files among files picked with `<input type="file" webkitdirectory>` (the fallback where showDirectoryPicker is missing). */
export function pakSourcesFromFiles(files: FileList): ByteSource[] {
  return [...files].filter((f) => f.name.toLowerCase().endsWith(".pak")).map((f) => new BlobSource(f.name, f));
}

/** Ask for read access again to a folder remembered from an earlier visit. Must run from a click. */
export async function ensureReadable(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as FileSystemDirectoryHandle & PermissionedHandle;
  if ((await h.queryPermission?.({ mode: "read" })) === "granted") return true;
  return (await h.requestPermission?.({ mode: "read" })) === "granted";
}

/** Dev server only: the archives and saved game that vite.config.ts serves from this machine. Null when that endpoint is absent. */
export async function localDevSources(pick?: string): Promise<{ paks: ByteSource[]; save: ByteSource | null } | null> {
  if (!import.meta.env.DEV) return null;
  try {
    const res = await fetch("/__local/manifest.json");
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
    const manifest = (await res.json()) as { paks: string[]; save: string | null; saves?: string[] };
    const paks = await Promise.all(manifest.paks.map((n) => HttpSource.open(n, `/__local/pak/${encodeURIComponent(n)}`)));
    // `pick`: part of a saved game's file name, to choose another save than the default one.
    const chosen = pick ? manifest.saves?.find((n) => n.toLowerCase().includes(pick.toLowerCase())) : undefined;
    const save = chosen
      ? await HttpSource.open(chosen, `/__local/save/${encodeURIComponent(chosen)}`)
      : manifest.save ? await HttpSource.open(manifest.save, "/__local/save") : null;
    return { paks, save };
  } catch {
    return null;
  }
}
