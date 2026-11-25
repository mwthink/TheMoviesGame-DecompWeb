# Web version

Babylon.js + TypeScript + Vite. No game assets live here; the game will load them from the user's own install.

```
npm install
npm run dev        # http://localhost:5173 (or the `web` entry in .claude/launch.json)
npm run build      # typecheck + production bundle in dist/
```

Flow: splash (3 s, or click/key) -> main menu (only Load Game is enabled) -> empty game view (Esc returns to the menu).
Menus are DOM screens in `src/screens/`; the game view owns the Babylon engine and scene.
