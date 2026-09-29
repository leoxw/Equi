import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import type {
  GeomPoints,
  MapProjection,
  ProjectedIsland,
  ProjectedProvince,
  SouthChinaSeaInset,
} from "../types";

type Ring = Position[];
type Pt = { x: number; y: number };

/** Mainland / Hainan island cutoff — rings south of this go to 南海 inset. */
const MAINLAND_LAT_CUTOFF = 17.8;

/** China Albers equal-area conic (common atlas / 标准分省图参数). */
const ALBERS = {
  lambda0: (105 * Math.PI) / 180,
  phi1: (25 * Math.PI) / 180,
  phi2: (47 * Math.PI) / 180,
  phi0: (0 * Math.PI) / 180,
};

const ALBERS_N =
  (Math.sin(ALBERS.phi1) + Math.sin(ALBERS.phi2)) / 2;
const ALBERS_C =
  Math.cos(ALBERS.phi1) ** 2 + 2 * ALBERS_N * Math.sin(ALBERS.phi1);
const ALBERS_RHO0 =
  Math.sqrt(ALBERS_C - 2 * ALBERS_N * Math.sin(ALBERS.phi0)) / ALBERS_N;

/**
 * 十段线：标准分段（MultiLineString），每段即地图上的一条短虚线。
 * 来源：公开 GeoJSON 十段线数据（WGS84）。
 */
const TEN_DASH_SEGMENTS: Position[][] = [
  [
    [109.51763678906526, 16.360467782665847],
    [109.72339159230361, 16.05587198177934],
    [109.8780414893003, 15.766823920473868],
    [109.96506402665503, 15.526031073258686],
    [109.98526818797363, 15.335615618596712],
  ],
  [
    [110.48331454715199, 12.431407837351566],
    [110.48240767589328, 12.085792287259398],
    [110.45136562643113, 11.863835000833953],
    [110.25652028695671, 11.393616070326182],
  ],
  [
    [108.3388949586325, 7.26656318024262],
    [108.30727608084116, 6.727803403200289],
    [108.35631901989032, 6.112648053307836],
  ],
  [
    [111.94112275674237, 3.553559321848772],
    [112.40151782268552, 3.646409974664658],
    [112.92104341055976, 3.845112027649191],
  ],
  [
    [115.69079809651517, 7.29016984601141],
    [116.4095482213759, 8.137962397303875],
  ],
  [
    [118.63503455703679, 11.080904139262175],
    [118.85587024190139, 11.457907321145406],
    [119.10128629647166, 12.062751715859875],
    [119.12181771101825, 12.135585760471585],
  ],
  [
    [119.60808384544805, 18.143451232827125],
    [119.91075760817219, 18.77194701315816],
    [120.11918953031866, 19.117669954512905],
  ],
  [
    [121.40591812413318, 20.8001943859176],
    [122.12216430894797, 21.716094829922323],
  ],
  [
    [122.80328441666389, 23.665545127578547],
    [123.00481138309124, 24.74934291726869],
  ],
  [
    [119.16836075308866, 15.107448879733406],
    [119.16981236678279, 15.755038547478351],
    [119.17823197590195, 16.265658015720753],
  ],
];

/** Standard 南海 inset geographic frame (GMT atlas style). */
const SCS_FRAME_BOUNDS = {
  minLon: 105,
  maxLon: 123,
  minLat: 3,
  maxLat: 24,
};

function isRing(coords: Position[]): coords is Ring {
  return coords.length > 0 && Array.isArray(coords[0]) && typeof coords[0][0] === "number";
}

function getRings(geometry: Polygon | MultiPolygon): Ring[] {
  if (geometry.type === "Polygon") {
    return geometry.coordinates.filter(isRing);
  }
  return geometry.coordinates.flat().filter(isRing);
}

/** Project WGS84 lon/lat (degrees) with China Albers conic. */
function projectLonLat(lon: number, lat: number): Pt {
  const lambda = (lon * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const theta = ALBERS_N * (lambda - ALBERS.lambda0);
  const rho = Math.sqrt(ALBERS_C - 2 * ALBERS_N * Math.sin(phi)) / ALBERS_N;
  return {
    x: rho * Math.sin(theta),
    y: -(ALBERS_RHO0 - rho * Math.cos(theta)),
  };
}

/** Local equirectangular for 南海 inset (keeps U-shape of 十段线 readable). */
function projectScsLonLat(lon: number, lat: number): Pt {
  const midLat = 14;
  return { x: lon * Math.cos((midLat * Math.PI) / 180), y: -lat };
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

function ringCentroid(ring: Ring): { lon: number; lat: number } {
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
      lon: (Math.min(...xs) + Math.max(...xs)) / 2,
      lat: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
  }
  return { lon: cx / (6 * a), lat: cy / (6 * a) };
}

function ringMaxLat(ring: Ring): number {
  let m = -Infinity;
  for (const p of ring) m = Math.max(m, p[1]);
  return m;
}

function bboxOfPoints(pts: Pt[]): {
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

function isMainlandRing(ring: Ring): boolean {
  return ringMaxLat(ring) >= MAINLAND_LAT_CUTOFF;
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

type Fit = {
  originX: number;
  originY: number;
  scale: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

function fitBounds(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  rect: { x: number; y: number; w: number; h: number },
  padFrac = 0.02,
): Fit {
  const geoW = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const geoH = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const padX = rect.w * padFrac;
  const padY = rect.h * padFrac;
  const scale = Math.min((rect.w - padX * 2) / geoW, (rect.h - padY * 2) / geoH);
  const usedW = geoW * scale;
  const usedH = geoH * scale;
  return {
    originX: rect.x + (rect.w - usedW) / 2,
    originY: rect.y + (rect.h - usedH) / 2,
    scale,
    bounds,
  };
}

function toSlide(p: Pt, fit: Fit): Pt {
  return {
    x: fit.originX + (p.x - fit.bounds.minX) * fit.scale,
    y: fit.originY + (p.y - fit.bounds.minY) * fit.scale,
  };
}

function buildShapeFromRings(
  rings: Pt[][],
  fit: Fit,
  svgScale: number,
  svgOrigin: Pt,
): {
  points: GeomPoints;
  box: { x: number; y: number; w: number; h: number };
  svgPath: string;
  centroid: Pt;
  svgCentroid: Pt;
} {
  const flat = rings.flat();
  const bb = bboxOfPoints(flat);
  const tl = toSlide({ x: bb.minX, y: bb.minY }, fit);
  const br = toSlide({ x: bb.maxX, y: bb.maxY }, fit);
  const box = {
    x: tl.x,
    y: tl.y,
    w: Math.max(br.x - tl.x, 0.015),
    h: Math.max(br.y - tl.y, 0.015),
  };

  const points: GeomPoints = [];
  const svgParts: string[] = [];

  for (const ring of rings) {
    ring.forEach((p, i) => {
      const s = toSlide(p, fit);
      const lx = s.x - box.x;
      const ly = s.y - box.y;
      const sx = (s.x - svgOrigin.x) * svgScale;
      const sy = (s.y - svgOrigin.y) * svgScale;
      if (i === 0) {
        points.push({ x: lx, y: ly, moveTo: true });
        svgParts.push(`M ${sx.toFixed(2)} ${sy.toFixed(2)}`);
      } else {
        points.push({ x: lx, y: ly });
        svgParts.push(`L ${sx.toFixed(2)} ${sy.toFixed(2)}`);
      }
    });
    points.push({ close: true });
    svgParts.push("Z");
  }

  // Approximate centroid from largest ring
  let best = 0;
  let bestArea = -1;
  rings.forEach((ring, i) => {
    // area in projected space
    let a = 0;
    for (let j = 0; j < ring.length - 1; j++) {
      a += ring[j].x * ring[j + 1].y - ring[j + 1].x * ring[j].y;
    }
    a = Math.abs(a / 2);
    if (a > bestArea) {
      bestArea = a;
      best = i;
    }
  });
  const geoC = (() => {
    const ring = rings[best];
    let cx = 0;
    let cy = 0;
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const cross = ring[i].x * ring[i + 1].y - ring[i + 1].x * ring[i].y;
      a += cross;
      cx += (ring[i].x + ring[i + 1].x) * cross;
      cy += (ring[i].y + ring[i + 1].y) * cross;
    }
    a *= 0.5;
    if (Math.abs(a) < 1e-12) {
      const b = bboxOfPoints(ring);
      return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    }
    return { x: cx / (6 * a), y: cy / (6 * a) };
  })();
  const centroid = toSlide(geoC, fit);
  const svgCentroid = {
    x: (centroid.x - svgOrigin.x) * svgScale,
    y: (centroid.y - svgOrigin.y) * svgScale,
  };

  return {
    points,
    box,
    svgPath: svgParts.join(" "),
    centroid,
    svgCentroid,
  };
}

/**
 * Project China province GeoJSON into slide inches + SVG viewBox space.
 * Mainland uses corrected aspect; 南海诸岛 go into a bottom-right inset.
 */
export function projectChinaMap(
  geo: FeatureCollection,
  slideW: number,
  slideH: number,
): MapProjection {
  type Working = {
    adcode: string;
    name: string;
    mainlandRings: Pt[][];
    geoCentroid: Pt;
  };

  const workings: Working[] = [];
  const mainlandPts: Pt[] = [];
  const scsRings: Pt[][] = [];
  const scsLonLatRings: Ring[] = [];

  for (const feature of geo.features as Feature<Polygon | MultiPolygon>[]) {
    const name = feature.properties?.name;
    if (!name || !feature.geometry) continue;
    const adcode = String(feature.properties!.adcode);
    const rawRings = getRings(feature.geometry);

    const mainlandRaw: Ring[] = [];
    for (const ring of rawRings) {
      if (isMainlandRing(ring)) mainlandRaw.push(ring);
      else {
        scsLonLatRings.push(ring);
        scsRings.push(ring.map(([lon, lat]) => projectScsLonLat(lon, lat)));
      }
    }
    if (mainlandRaw.length === 0) continue;

    // Keep significant mainland rings (drop micro islands near coast relative to main body)
    const areas = mainlandRaw.map(ringArea);
    const maxArea = Math.max(...areas, 0);
    const kept = mainlandRaw.filter(
      (_, i) => areas[i] >= maxArea * 0.0015 || areas[i] === maxArea,
    );

    const projected = kept.map((ring) =>
      ring.map(([lon, lat]) => {
        const p = projectLonLat(lon, lat);
        mainlandPts.push(p);
        return p;
      }),
    );

    let main = 0;
    const keptAreas = kept.map(ringArea);
    for (let i = 1; i < kept.length; i++) {
      if (keptAreas[i] > keptAreas[main]) main = i;
    }
    const c = ringCentroid(kept[main]);
    workings.push({
      adcode,
      name,
      mainlandRings: projected,
      geoCentroid: projectLonLat(c.lon, c.lat),
    });
  }

  const bounds = bboxOfPoints(mainlandPts);

  // Leave room on the right for callouts.
  const marginX = slideW * 0.035;
  const marginY = slideH * 0.1;
  const mapW = slideW * 0.62;
  const mapH = slideH - marginY * 2;
  const mapRect = { x: marginX, y: marginY, w: mapW, h: mapH };
  const mainFit = fitBounds(bounds, mapRect, 0.03);

  // South China Sea inset — 75% of previous atlas size, bottom-right of map area.
  const insetW = mapRect.w * 0.18 * 0.75;
  const insetH = mapRect.h * 0.38 * 0.75;
  const insetBox = {
    x: mapRect.x + mapRect.w - insetW + mapRect.w * 0.01,
    y: mapRect.y + mapRect.h - insetH - mapRect.h * 0.01,
    w: insetW,
    h: insetH,
  };

  // Fit SCS content into standard atlas frame 105–123°E / 3–24°N.
  const scsPts: Pt[] = [
    projectScsLonLat(SCS_FRAME_BOUNDS.minLon, SCS_FRAME_BOUNDS.minLat),
    projectScsLonLat(SCS_FRAME_BOUNDS.maxLon, SCS_FRAME_BOUNDS.minLat),
    projectScsLonLat(SCS_FRAME_BOUNDS.maxLon, SCS_FRAME_BOUNDS.maxLat),
    projectScsLonLat(SCS_FRAME_BOUNDS.minLon, SCS_FRAME_BOUNDS.maxLat),
  ];
  for (const ring of scsRings) scsPts.push(...ring);
  for (const seg of TEN_DASH_SEGMENTS) {
    for (const [lon, lat] of seg) scsPts.push(projectScsLonLat(lon, lat));
  }
  const scsBounds = bboxOfPoints(scsPts);
  const scsFit = fitBounds(scsBounds, insetBox, 0.06);

  const svgScale = 20;
  // Preview/SVG uses the full slide canvas so callouts and 南海 inset don't collide.
  const svgOrigin = { x: 0, y: 0 };
  const vbPad = 0;
  const viewBox = {
    minX: vbPad,
    minY: vbPad,
    width: slideW * svgScale,
    height: slideH * svgScale,
  };

  const provinces: ProjectedProvince[] = workings.map((w) => {
    const shape = buildShapeFromRings(w.mainlandRings, mainFit, svgScale, svgOrigin);
    // Prefer geographic centroid mapped through main fit
    const centroid = toSlide(w.geoCentroid, mainFit);
    return {
      adcode: w.adcode,
      name: w.name,
      points: shape.points,
      box: shape.box,
      centroid,
      svgPath: shape.svgPath,
      svgCentroid: {
        x: (centroid.x - svgOrigin.x) * svgScale,
        y: (centroid.y - svgOrigin.y) * svgScale,
      },
    };
  });

  // Keep only larger SCS islands for clarity (drop noise dots).
  const islandCandidates = scsLonLatRings
    .map((ring, i) => ({ ring, area: ringArea(ring), projected: scsRings[i] }))
    .sort((a, b) => b.area - a.area);
  const areaThresh = islandCandidates[0] ? islandCandidates[0].area * 0.02 : 0;
  const keptIslands = islandCandidates.filter(
    (c, i) => i < 40 || c.area >= areaThresh,
  );

  const islands: ProjectedIsland[] = keptIslands.map((c) => {
    const shape = buildShapeFromRings([c.projected], scsFit, svgScale, svgOrigin);
    return {
      points: shape.points,
      box: shape.box,
      svgPath: shape.svgPath,
    };
  });

  // Ten-dash line: each GeoJSON segment is one atlas dash stroke.
  const dashes: SouthChinaSeaInset["dashes"] = [];
  const dashSvg: string[] = [];
  for (const seg of TEN_DASH_SEGMENTS) {
    if (seg.length < 2) continue;
    const pts = seg.map(([lon, lat]) => toSlide(projectScsLonLat(lon, lat), scsFit));
    for (let i = 0; i < pts.length - 1; i++) {
      dashes.push({
        x1: pts[i].x,
        y1: pts[i].y,
        x2: pts[i + 1].x,
        y2: pts[i + 1].y,
      });
    }
    const parts: string[] = [];
    pts.forEach((p, i) => {
      const sx = (p.x - svgOrigin.x) * svgScale;
      const sy = (p.y - svgOrigin.y) * svgScale;
      parts.push(`${i === 0 ? "M" : "L"} ${sx.toFixed(2)} ${sy.toFixed(2)}`);
    });
    dashSvg.push(parts.join(" "));
  }

  const scsInset: SouthChinaSeaInset = {
    box: insetBox,
    svgBox: {
      x: (insetBox.x - svgOrigin.x) * svgScale,
      y: (insetBox.y - svgOrigin.y) * svgScale,
      w: insetBox.w * svgScale,
      h: insetBox.h * svgScale,
    },
    islands,
    dashes,
    dashSvgPath: dashSvg.join(" "),
  };

  return {
    provinces,
    viewBox,
    mapRect: {
      x: mainFit.originX,
      y: mainFit.originY,
      w: (bounds.maxX - bounds.minX) * mainFit.scale,
      h: (bounds.maxY - bounds.minY) * mainFit.scale,
    },
    scsInset,
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
  void centroid;
  return {
    x: Math.min(rightCol, slideW - w - 0.25),
    y: Math.max(0.3, Math.min(y, slideH - h - 0.3)),
    w,
    h,
  };
}
