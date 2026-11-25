import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { defaultSave, PAK_DIR, SAVE_DIR } from "./localPaths.ts";

/**
 * Dev only: serve the game's archives and one saved game from this machine, so the app can be tried without picking files in a dialog.
 * Nothing is bundled or copied; the files are read from disk on request (with Range support, as the pak reader asks for slices).
 * Paths come from localPaths.ts (environment or local.env): the archives of OTM_GAME_DIR, and OTM_SAVE or the first save in OTM_SAVE_DIR (every .jad next to it is offered too).
 */
function localGameFiles(): Plugin {
  const pakDir = PAK_DIR ?? "";
  const savePath = defaultSave() ?? "";
  const saveDir = savePath ? dirname(savePath) : SAVE_DIR;
  return {
    name: "otm-local-game-files",
    configureServer(server) {
      server.middlewares.use("/__local", (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        let file: string | null = null;
        if (url.pathname === "/manifest.json") {
          const paks = existsSync(pakDir) ? readdirSync(pakDir).filter((n) => n.toLowerCase().endsWith(".pak")) : [];
          res.setHeader("content-type", "application/json");
          const saves = existsSync(saveDir) ? readdirSync(saveDir).filter((n) => n.toLowerCase().endsWith(".jad")).sort() : [];
          res.end(JSON.stringify({ paks, save: existsSync(savePath) ? savePath.split("/").pop() : null, saves }));
          return;
        }
        if (url.pathname === "/save") file = savePath;
        else if (url.pathname.startsWith("/save/")) {
          const name = decodeURIComponent(url.pathname.slice(6));
          if (!name.includes("/") && !name.includes("..") && name.toLowerCase().endsWith(".jad")) file = join(saveDir, name);
        }
        else if (url.pathname.startsWith("/pak/")) {
          const name = decodeURIComponent(url.pathname.slice(5));
          if (!name.includes("/") && !name.includes("..")) file = join(pakDir, name);
        }
        if (!file || !existsSync(file)) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        const size = statSync(file).size;
        res.setHeader("accept-ranges", "bytes");
        res.setHeader("content-type", "application/octet-stream");
        const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
        if (m) {
          const start = Number(m[1]);
          const end = Math.min(size - 1, m[2] ? Number(m[2]) : size - 1);
          res.statusCode = 206;
          res.setHeader("content-range", `bytes ${start}-${end}/${size}`);
          res.setHeader("content-length", end - start + 1);
          createReadStream(file, { start, end }).pipe(res);
        } else {
          res.setHeader("content-length", size);
          if (req.method === "HEAD") res.end();
          else createReadStream(file).pipe(res);
        }
      });
    },
  };
}

export default defineConfig({
  server: { port: 5173, strictPort: true },
  plugins: [localGameFiles()],
});
