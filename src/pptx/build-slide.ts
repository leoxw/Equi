import type { AppConfig, MapProjection, ProvinceTip } from "../types";
import { shortProvinceName } from "../types";
import PptxGenJS from "pptxgenjs";
import { placeCallout } from "../map/project";

export interface BuiltSlideMeta {
  provinceShapeNames: Array<{ adcode: string; shapeName: string }>;
  calloutShapeNames: Array<{ adcode: string; shapeName: string }>;
}

function hex(color: string): string {
  return color.replace(/^#/, "").toUpperCase();
}

export async function buildPptxBlob(
  config: AppConfig,
  projection: MapProjection,
): Promise<{ blob: Blob; meta: BuiltSlideMeta }> {
  const pptx = new PptxGenJS();
  const { widthIn, heightIn } = config.size;

  pptx.defineLayout({ name: "CUSTOM_MAP", width: widthIn, height: heightIn });
  pptx.layout = "CUSTOM_MAP";
  pptx.author = "Equi China Map PPTX";
  pptx.title = config.title || "中国分省地图";

  const slide = pptx.addSlide();
  slide.background = { color: hex(config.theme.slideBg) };

  slide.addText(config.title || "中国分省地图", {
    x: 0.35,
    y: 0.22,
    w: widthIn - 0.7,
    h: 0.45,
    fontSize: 22,
    fontFace: "Microsoft YaHei",
    color: hex(config.theme.calloutText),
    bold: true,
    margin: 0,
  });

  const selected = new Set(config.selectedOrder);
  const provinceShapeNames: BuiltSlideMeta["provinceShapeNames"] = [];
  const calloutShapeNames: BuiltSlideMeta["calloutShapeNames"] = [];

  for (const prov of projection.provinces) {
    const isHi = selected.has(prov.adcode);
    const shapeName = `prov_${prov.adcode}`;
    provinceShapeNames.push({ adcode: prov.adcode, shapeName });

    slide.addShape("custGeom" as PptxGenJS.ShapeType, {
      x: prov.box.x,
      y: prov.box.y,
      w: prov.box.w,
      h: prov.box.h,
      fill: {
        color: hex(isHi ? config.theme.highlight : config.theme.mapFill),
      },
      line: {
        color: hex(isHi ? config.theme.highlightStroke : config.theme.mapStroke),
        width: isHi ? 1.25 : 0.75,
      },
      points: prov.points as PptxGenJS.ShapeProps["points"],
      objectName: shapeName,
      shadow: isHi
        ? {
            type: "outer",
            color: hex(config.theme.highlight),
            blur: 6,
            offset: 0,
            opacity: 0.35,
          }
        : undefined,
    });
  }

  config.selectedOrder.forEach((adcode, index) => {
    const tip = config.tips[adcode];
    const prov = projection.provinces.find((p) => p.adcode === adcode);
    if (!tip || !prov) return;

    const box = placeCallout(
      prov.centroid,
      widthIn,
      heightIn,
      index,
      config.selectedOrder.length,
    );
    const shapeName = `callout_${adcode}`;
    calloutShapeNames.push({ adcode, shapeName });

    // Background rounded rect
    slide.addShape(pptx.ShapeType.roundRect, {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fill: { color: hex(config.theme.calloutBg) },
      line: { color: hex(config.theme.calloutAccent), width: 1.5 },
      rectRadius: 0.1,
      objectName: shapeName,
      shadow: {
        type: "outer",
        color: "000000",
        blur: 8,
        offset: 2,
        opacity: 0.35,
      },
    });

    // Accent bar (same object group visually; separate shape for text layering)
    const textName = `callout_text_${adcode}`;
    calloutShapeNames.push({ adcode, shapeName: textName });

    const lines = buildCalloutLines(tip);
    slide.addText(lines, {
      x: box.x + 0.12,
      y: box.y + 0.1,
      w: box.w - 0.24,
      h: box.h - 0.2,
      fontFace: "Microsoft YaHei",
      color: hex(config.theme.calloutText),
      valign: "top",
      margin: 0,
      objectName: textName,
    });
  });

  const blob = (await pptx.write({ outputType: "blob" })) as Blob;
  return { blob, meta: { provinceShapeNames, calloutShapeNames } };
}

function buildCalloutLines(tip: ProvinceTip): PptxGenJS.TextProps[] {
  const title = tip.title?.trim() || shortProvinceName(tip.name);
  const rows: PptxGenJS.TextProps[] = [
    {
      text: title,
      options: {
        fontSize: 14,
        bold: true,
        breakLine: true,
        color: undefined,
      },
    },
  ];

  const fields = tip.fields.filter((f) => f.key.trim() || f.value.trim());
  fields.forEach((f, i) => {
    const label = f.key.trim() || "指标";
    const value = f.value.trim() || "—";
    rows.push({
      text: `${label}  ${value}`,
      options: {
        fontSize: 11,
        breakLine: i < fields.length - 1,
      },
    });
  });

  return rows;
}
