#!/usr/bin/env node
/**
 * Build iOS 9 / Safari 9 compatible siblings of the modern app.js/style.css.
 *
 * Reads the readable root app.js/style.css and writes app.legacy.js /
 * style.legacy.css next to them. index.html's tiny feature-detect bootstrap
 * picks whichever pair the browser can run — the modern files are never
 * rewritten or moved.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as babel from "@babel/core";
import postcss from "postcss";
import autoprefixer from "autoprefixer";
import postcssCustomProperties from "postcss-custom-properties";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// iPad mini 1st-gen native resolution, landscape — the one fixed display this
// build targets, so clamp()'s responsive min/max can collapse to one static px value.
const VIEWPORT = { width: 1024, height: 768 };

// esbuild deliberately never lowers let/const/classes/async below ES2015, so it
// can't reach Safari 9 — Babel is the one that actually rewrites let/const to
// var, arrow fns to functions, destructuring/spread/optional-chaining to plain
// JS, and async/await to regenerator-runtime-based generators.
async function buildJs() {
  const entryPath = path.join(root, "app.js");
  const source = await readFile(entryPath, "utf8");
  const { code } = await babel.transformAsync(source, {
    filename: "app.js",
    presets: [["@babel/preset-env", { targets: { safari: "9" }, useBuiltIns: false }]],
  });

  // Safari 9 has no fetch() and no regeneratorRuntime for the transformed
  // async/await — both ship as plain global-attaching scripts, concatenated
  // ahead of the transformed app code (no bundler needed, app.js has no imports).
  const regeneratorRuntime = await readFile(
    path.join(root, "node_modules/regenerator-runtime/runtime.js"),
    "utf8"
  );
  const whatwgFetch = await readFile(
    path.join(root, "node_modules/whatwg-fetch/dist/fetch.umd.js"),
    "utf8"
  );

  await writeFile(
    path.join(root, "app.legacy.js"),
    `${regeneratorRuntime}\n${whatwgFetch}\n${code}`
  );
}

// `inset: <t r b l>` -> longhand top/right/bottom/left (Safari 9 lacks `inset`)
function insetExpand() {
  return {
    postcssPlugin: "inset-expand",
    Declaration: {
      inset(decl) {
        const parts = decl.value.trim().split(/\s+/);
        let top, right, bottom, left;
        if (parts.length === 1) [top, right, bottom, left] = [parts[0], parts[0], parts[0], parts[0]];
        else if (parts.length === 2) [top, right, bottom, left] = [parts[0], parts[1], parts[0], parts[1]];
        else if (parts.length === 3) [top, right, bottom, left] = [parts[0], parts[1], parts[2], parts[1]];
        else [top, right, bottom, left] = parts;
        decl.cloneBefore({ prop: "top", value: top });
        decl.cloneBefore({ prop: "right", value: right });
        decl.cloneBefore({ prop: "bottom", value: bottom });
        decl.cloneBefore({ prop: "left", value: left });
        decl.remove();
      },
    },
  };
}
insetExpand.postcss = true;

function toPx(expr, viewport) {
  const m = expr.trim().match(/^(-?[\d.]+)(px|vw|vh|rem|em)?$/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  switch (m[2] || "px") {
    case "vw": return (num / 100) * viewport.width;
    case "vh": return (num / 100) * viewport.height;
    case "rem":
    case "em": return num * 16;
    default: return num;
  }
}

// clamp(min, preferred, max) -> static px, using the preferred value evaluated
// at VIEWPORT (Safari 9 doesn't support clamp() at all; a fixed-size display
// doesn't need the responsive min/max anyway)
function clampFallback(viewport) {
  return {
    postcssPlugin: "clamp-fallback",
    Declaration(decl) {
      if (!decl.value.includes("clamp(")) return;
      decl.value = decl.value.replace(/clamp\(([^)]+)\)/g, (match, inner) => {
        const args = inner.split(",").map((s) => s.trim());
        if (args.length !== 3) return match;
        const px = toPx(args[1], viewport);
        return px === null ? args[1] : `${Math.round(px * 100) / 100}px`;
      });
    },
  };
}
clampFallback.postcss = true;

async function buildCss() {
  const fromPath = path.join(root, "style.css");
  const toPath = path.join(root, "style.legacy.css");
  const css = await readFile(fromPath, "utf8");
  const result = await postcss([
    postcssCustomProperties({ preserve: false }),
    insetExpand(),
    clampFallback(VIEWPORT),
    autoprefixer({ overrideBrowserslist: ["safari 9"] }),
  ]).process(css, { from: fromPath, to: toPath });
  await writeFile(toPath, result.css);
}

await buildJs();
await buildCss();
console.log("Built app.legacy.js and style.legacy.css");
