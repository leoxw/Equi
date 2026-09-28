import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import type { MapProjection, ProjectedProvince } from "../types";

type Ring = Position[];

function isRing(coords: Position[]): coords is Ring {
  return coords.length > 0 && Array.isArray(coords[0]) && typeof coords[0][0] === "number";
}

function getRings(geometry: Polygon | MultiPolygon): Ring[] {
  if (geometry.type === "Polygon") {
    return geometry.coordinates.filter(isRing);
  }
  return geometry.coordinates.flat().filter(isRing);
}

/** Equirectangular-ish China focus: longitude as x, latitude as y (flipped). */
function projectLonLat(lon: number, lat: number): { x: number; y: number } {
  return { x: lon, y: -lat };
}

function ringArea(ring: Ring): number {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

function ringCentroid(ring: Ring): { x: number; y: number } {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-12) {
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    return {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

function bboxOfPoints(pts: { x: number; y: number }[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

export function loadProvinceMeta(
  geo: FeatureCollection,
): Array<{ adcode: string; name: string }> {
  return geo.features
    .filter((f) => f.properties?.name)
    .map((f) => ({
      adcode: String(f.properties!.adcode),
      name: String(f.properties!.name),
    }))
    .sort((a, b) => a.adcode.localeCompare(b.adcode));
}

/**
 * Project China province GeoJSON into slide inches + SVG viewBox space.
 */
export function projectChinaMap(
  geo: FeatureCollection,
  slideW: number,
  slideH: number,
): MapProjection {
  type Working = {
    adcode: string;
    name: string;
    rings: { x: number; y: number }[][];
    geoCentroid: { x: number; y: number };
  };

  const workings: Working[] = [];
  const allPts: { x: number; y: number }[] = [];

  for (const feature of geo.features as Feature<Polygon | MultiPolygon>[]) {
    const name = feature.properties?.name;
    if (!name || !feature.geometry) continue;
    const adcode = String(feature.properties!.adcode);
    const rawRings = getRings(feature.geometry);
    // Drop tiny island rings relative to the largest ring to keep PPT light.
    const areas = rawRings.map(ringArea);
    const maxArea = Math.max(...areas, 0);
    const kept = rawRings.filter((_, i) => areas[i] >= maxArea * 0.002 || areas[i] === maxArea);
    const projected = kept.map((ring) =>
      ring.map(([lon, lat]) => {
        const p = projectLonLat(lon, lat);
        allPts.push(p);
        return p;
      }),
    );
    let main = 0;
    for (let i = 1; i < kept.length; i++) {
      if (areas[i] > areas[main]) main = i;
    }
    const c = ringCentroid(kept[main]);
    const gc = projectLonLat(c.x, c.y);
    workings.push({ adcode, name, rings: projected, geoCentroid: gc });
  }

  const bounds = bboxOfPoints(allPts);
  const geoW = bounds.maxX - bounds.minX;
  const geoH = bounds.maxY - bounds.minY;

  // Leave room on the right for callouts on widescreen.
  const marginX = slideW * 0.04;
  const marginY = slideH * 0.1;
  const mapW = slideW * 0.62;
  const mapH = slideH - marginY * 2;
  const scale = Math.min(mapW / geoW, mapH / geoH);
  const usedW = geoW * scale;
  const usedH = geoH * scale;
  const originX = marginX + (mapW - usedW) / 2;
  const originY = marginY + (mapH - usedH) / 2;

  // SVG viewBox mirrors the same aspect (pixel-like units).
  const vbPad = 8;
  const viewBox = {
    minX: -vbPad,
    minY: -vbPad,
    width: usedW * 20 + vbPad * 2,
    height: usedH * 20 + vbPad * 2,
  };
  const svgScale = 20;

  const provinces: ProjectedProvince[] = workings.map((w) => {
    const flat = w.rings.flat();
    const bb = bboxOfPoints(flat);
    const box = {
      x: originX + (bb.minX - bounds.minX) * scale,
      y: originY + (bb.minY - bounds.minY) * scale,
      w: Math.max((bb.maxX - bb.minX) * scale, 0.02),
      h: Math.max((bb.maxY - bb.minY) * scale, 0.02),
    };

    const points: ProjectedProvince["points"] = [];
    const svgParts: string[] = [];

    for (const ring of w.rings) {
      ring.forEach((p, i) => {
        const lx = (p.x - bb.minX) * scale;
        const ly = (p.y - bb.minY) * scale;
        if (i === 0) {
          points.push({ x: lx, y: ly, moveTo: true });
          const sx = (p.x - bounds.minX) * scale * svgScale;
          const sy = (p.y - bounds.minY) * scale * svgScale;
          svgParts.push(`M ${sx.toFixed(2)} ${sy.toFixed(2)}`);
        } else {
          points.push({ x: lx, y: ly });
          const sx = (p.x - bounds.minX) * scale * svgScale;
          const sy = (p.y - bounds.minY) * scale * svgScale;
          svgParts.push(`L ${sx.toFixed(2)} ${sy.toFixed(2)}`);
        }
      });
      points.push({ close: true });
      svgParts.push("Z");
    }

    const centroid = {
      x: originX + (w.geoCentroid.x - bounds.minX) * scale,
      y: originY + (w.geoCentroid.y - bounds.minY) * scale,
    };
    const svgCentroid = {
      x: (w.geoCentroid.x - bounds.minX) * scale * svgScale,
      y: (w.geoCentroid.y - bounds.minY) * scale * svgScale,
    };

    return {
      adcode: w.adcode,
      name: w.name,
      points,
      box,
      centroid,
      svgPath: svgParts.join(" "),
      svgCentroid,
    };
  });

  return {
    provinces,
    viewBox,
    mapRect: { x: originX, y: originY, w: usedW, h: usedH },
  };
}

export function placeCallout(
  centroid: { x: number; y: number },
  slideW: number,
  slideH: number,
  index: number,
  total: number,
): { x: number; y: number; w: number; h: number } {
  const w = Math.min(3.4, slideW * 0.28);
  const h = 1.55;
  const rightCol = slideW * 0.68;
  const top = slideH * 0.12;
  const gap = (slideH * 0.76 - total * h) / Math.max(total + 1, 1);
  const y = top + gap * (index + 1) + h * index;
  // Prefer right column; if province is already on the right, still use column for clarity.
  void centroid;
  return {
    x: Math.min(rightCol, slideW - w - 0.25),
    y: Math.max(0.3, Math.min(y, slideH - h - 0.3)),
    w,
    h,
  };
}
