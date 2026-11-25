// Guards for the world's shader sources. Babylon's shader preprocessor mishandles some comments (an apostrophe or a semicolon in a // comment broke the static shader's
// compile with "'off' : syntax error", so the world never finished loading), and the browser is the only real compiler, so keep comments in the TypeScript around the strings.
// The file imports Babylon (which Node cannot load here), so the sources are read as text: every template literal in shaders.ts is a shader.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("shader sources have no line comments with quotes or semicolons", () => {
  const text = readFileSync(new URL("../src/world/shaders.ts", import.meta.url), "utf8");
  const sources = [...text.matchAll(/`([^`]*)`/g)].map((m) => m[1]!);
  assert.ok(sources.length >= 6, `${sources.length} shader sources found`);
  for (const source of sources) {
    for (const line of source.split("\n")) {
      const at = line.indexOf("//");
      if (at < 0) continue;
      const comment = line.slice(at);
      assert.ok(!/['";]/.test(comment), `unsafe comment in a shader: ${comment.trim()}`);
    }
  }
});
