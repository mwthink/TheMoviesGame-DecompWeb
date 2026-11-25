# Web version

Babylon.js + TypeScript + Vite. No game assets live here; the app reads the player's own game install and a saved game in the browser.

```
npm install        # once; set OTM_GAME_DIR in ../local.env first (../local.env.example)
npm run dev        # http://localhost:5173/?autoload  (dev only: the saved world from this machine's game files, no menus)
npm test           # parser tests against the real game files (skipped when absent)
npm run build      # typecheck + production bundle in dist/
```

Flow: splash -> main menu (only Load Game is enabled) -> pick game folder and `.jad` -> world view (drag to orbit, Esc back to the menu).
Details, decisions and gaps: [`../docs/WEB.md`](../docs/WEB.md). Start the dev server from a terminal: some sandboxed preview servers cannot read the game files.
