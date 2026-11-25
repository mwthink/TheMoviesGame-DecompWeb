import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * Dev only: serve the game's archives and one saved game from this machine, so the app can be tried without picking files in a dialog.
 * Nothing is bundled or copied; the files are read from disk on request (with Range support, as the pak reader asks for slices).
 * Paths: OTM_PAK_DIR and OTM_SAVE, defaulting to the CrossOver install and Saved Games folder used by the Python tools and the tests.
 */
function localGameFiles(): Plugin {
  const pakDir = process.env.OTM_PAK_DIR ?? join(homedir(), "Library/Application Support/CrossOver/Bottles/tmovies/drive_c/Games/TheMovies/Data/pak");
  const savePath = process.env.OTM_SAVE ?? join(homedir(), "Documents/The Movies/Saved Games/wine studios1 January 19202357Monday23November2026.jad");
  return {
    name: "otm-local-game-files",
    configureServer(server) {
      server.middlewares.use("/__local", (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        let file: string | null = null;
        if (url.pathname === "/manifest.json") {
          const paks = existsSync(pakDir) ? readdirSync(pakDir).filter((n) => n.toLowerCase().endsWith(".pak")) : [];
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ paks, save: existsSync(savePath) ? savePath.split("/").pop() : null }));
          return;
        }
        if (url.pathname === "/save") file = savePath;
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
