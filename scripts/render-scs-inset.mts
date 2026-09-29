import { writeFileSync } from "fs";
import chinaGeo from "../src/map/china-provinces.json";
import { projectChinaMap } from "../src/map/project.ts";
import { softScsColors } from "../src/ui/colors.ts";
import { DEFAULT_THEME } from "../src/types.ts";
import type { FeatureCollection } from "geojson";

const p = projectChinaMap(chinaGeo as FeatureCollection, 13.333, 7.5);
const scs = p.scsInset;
const theme = DEFAULT_THEME;
const c = softScsColors(theme);
const pad = 4;
const vb = {
  x: scs.svgBox.x - pad,
  y: scs.svgBox.y - pad,
  w: scs.svgBox.w + pad * 2,
  h: scs.svgBox.h + pad * 2,
};
const mainland = scs.mainland
  .map(
    (i) =>
      `<path fill="#${c.mainlandFill}" stroke="#${c.mainlandStroke}" stroke-width="0.7" d="${i.svgPath}"/>`,
  )
  .join("");
const islands = scs.islands
  .map(
    (i) =>
      `<path fill="#${c.island}" stroke="#${c.islandStroke}" stroke-width="0.35" d="${i.svgPath}"/>`,
  )
  .join("");
const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" width="360" height="${Math.round((360 * vb.h) / vb.w)}">
  <rect x="${scs.svgBox.x}" y="${scs.svgBox.y}" width="${scs.svgBox.w}" height="${scs.svgBox.h}" fill="#fff" stroke="#999" stroke-width="1.2"/>
  ${mainland}${islands}
  <path d="${scs.dashSvgPath}" fill="none" stroke="#${c.dash}" stroke-width="1" stroke-linecap="round"/>
</svg>`;
writeFileSync(
  "/tmp/scs-inset-only.html",
  `<!doctype html><html><body style="margin:20px;background:#eee">${svg}</body></html>`,
);
let minY = Infinity;
for (const m of scs.mainland) minY = Math.min(minY, m.box.y);
console.log({
  frameTop: scs.box.y,
  mainlandTop: minY,
  gapIn: +(minY - scs.box.y).toFixed(4),
  gapPct: `${(((minY - scs.box.y) / scs.box.h) * 100).toFixed(2)}%`,
});
