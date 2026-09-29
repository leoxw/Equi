import { writeFileSync } from "fs";
import chinaGeo from "../src/map/china-provinces.json";
import { projectChinaMap } from "../src/map/project.ts";
import type { FeatureCollection } from "geojson";

const p = projectChinaMap(chinaGeo as FeatureCollection, 13.333, 7.5);
const { viewBox: vb, scsInset: scs } = p;
const paths = p.provinces
  .map((prov) => {
    const hi = ["320000", "330000", "440000"].includes(prov.adcode);
    return `<path fill="${hi ? "#2DD4BF" : "#1A3A4A"}" stroke="${hi ? "#99F6E4" : "#2E5A6E"}" stroke-width="${hi ? 1.2 : 0.6}" d="${prov.svgPath}"/>`;
  })
  .join("\n");
const islands = scs.islands
  .map(
    (i) =>
      `<path fill="#1A3A4A" stroke="#2E5A6E" stroke-width="0.4" d="${i.svgPath}"/>`,
  )
  .join("\n");
const h = Math.round((900 * vb.height) / vb.width);
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.minX} ${vb.minY} ${vb.width} ${vb.height}" width="900" height="${h}">
  <rect x="${vb.minX}" y="${vb.minY}" width="${vb.width}" height="${vb.height}" fill="#071018"/>
  ${paths}
  <rect x="${scs.svgBox.x}" y="${scs.svgBox.y}" width="${scs.svgBox.w}" height="${scs.svgBox.h}" fill="#0b1c28" stroke="#5eead4" stroke-width="2" rx="2"/>
  ${islands}
  <path d="${scs.dashSvgPath}" fill="none" stroke="#99F6E4" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;
writeFileSync("/opt/cursor/artifacts/screenshots/map-render.svg", svg);
writeFileSync(
  "/tmp/map-render.html",
  `<!doctype html><html><body style="margin:0;background:#071018;display:flex;justify-content:center;padding:20px">${svg}</body></html>`,
);
console.log({
  ratio: +(p.mapRect.w / p.mapRect.h).toFixed(3),
  islands: scs.islands.length,
  dashes: scs.dashes.length,
  inset: scs.svgBox,
  vb,
});
