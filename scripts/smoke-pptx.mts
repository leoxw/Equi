/**
 * Headless smoke test: build a PPTX and verify animation timing exists.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import chinaGeo from "../src/map/china-provinces.json" with { type: "json" };
import { projectChinaMap } from "../src/map/project.ts";
import { buildPptxBlob } from "../src/pptx/build-slide.ts";
import { injectAnimations } from "../src/pptx/inject-animations.ts";
import { DEFAULT_STROKE_WIDTHS, DEFAULT_THEME } from "../src/types.ts";
import type { AppConfig } from "../src/types.ts";
import type { FeatureCollection } from "geojson";
import JSZip from "jszip";

async function main() {
  const geo = chinaGeo as FeatureCollection;
  const config: AppConfig = {
    size: { preset: "16:9", widthIn: 13.333, heightIn: 7.5 },
    title: "测试区域重点省份",
    selectedOrder: ["320000", "330000", "350000"],
    tips: {
      "320000": {
        adcode: "320000",
        name: "江苏省",
        title: "江苏",
        fields: [{ id: "1", key: "重发授权", value: "31081" }],
      },
      "330000": {
        adcode: "330000",
        name: "浙江省",
        title: "浙江",
        fields: [{ id: "1", key: "重发授权", value: "19409" }],
      },
      "350000": {
        adcode: "350000",
        name: "福建省",
        title: "福建",
        fields: [{ id: "1", key: "重发授权", value: "74838" }],
      },
    },
    theme: { ...DEFAULT_THEME },
    strokeWidths: { ...DEFAULT_STROKE_WIDTHS },
  };

  const projection = projectChinaMap(geo, config.size.widthIn, config.size.heightIn);
  console.log("provinces projected:", projection.provinces.length);

  const { blob, meta } = await buildPptxBlob(config, projection);
  console.log("base pptx bytes:", blob.size);
  console.log("province shapes:", meta.provinceShapeNames.length);
  console.log("callout shapes:", meta.calloutShapeNames.length);

  const animated = await injectAnimations(blob, meta, config.selectedOrder);
  const buf = Buffer.from(await animated.arrayBuffer());
  mkdirSync("/tmp/china-map-pptx-test", { recursive: true });
  const outPath = "/tmp/china-map-pptx-test/demo.pptx";
  writeFileSync(outPath, buf);
  console.log("wrote", outPath, buf.length);

  const zip = await JSZip.loadAsync(buf);
  const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  const checks = [
    ["has timing", slideXml.includes("<p:timing>")],
    ["has pulse", slideXml.includes("<p:animScale>")],
    ["has appear", slideXml.includes("style.visibility")],
    ["has prov_320000", slideXml.includes('name="prov_320000"')],
    ["has callout_320000", slideXml.includes('name="callout_320000"')],
    ["has clickEffect", slideXml.includes('nodeType="clickEffect"')],
    ["has custGeom", slideXml.includes("<a:custGeom>")],
  ] as const;

  for (const [label, ok] of checks) {
    console.log(ok ? "OK" : "FAIL", label);
    if (!ok) process.exitCode = 1;
  }

  // Count named province shapes
  const provMatches = slideXml.match(/name="prov_\d+"/g) || [];
  console.log("named province shapes in xml:", provMatches.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
