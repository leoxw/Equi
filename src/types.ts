export type SlideSizePreset = "16:9" | "4:3" | "16:10" | "custom";

export interface SlideSize {
  preset: SlideSizePreset;
  widthIn: number;
  heightIn: number;
}

export interface DataField {
  id: string;
  key: string;
  value: string;
}

export interface ProvinceTip {
  adcode: number | string;
  name: string;
  title: string;
  fields: DataField[];
}

export interface ThemeColors {
  mapFill: string;
  mapStroke: string;
  highlight: string;
  highlightStroke: string;
  calloutBg: string;
  calloutText: string;
  calloutAccent: string;
  slideBg: string;
}

/** Province border widths in PowerPoint points (also drives SVG preview). */
export interface StrokeWidths {
  map: number;
  highlight: number;
}

export interface AppConfig {
  size: SlideSize;
  title: string;
  selectedOrder: string[];
  tips: Record<string, ProvinceTip>;
  theme: ThemeColors;
  strokeWidths: StrokeWidths;
}

export type GeomPoints = Array<
  | { x: number; y: number; moveTo?: boolean }
  | { close: true }
>;

export interface ProjectedProvince {
  adcode: string;
  name: string;
  /** Absolute inch coordinates for pptx CUSTOM_GEOMETRY (relative to shape box). */
  points: GeomPoints;
  /** Bounding box of the shape on the slide (inches). */
  box: { x: number; y: number; w: number; h: number };
  /** Centroid on the slide (inches). */
  centroid: { x: number; y: number };
  /** SVG path in projected pixel/viewBox space for preview. */
  svgPath: string;
  /** Centroid in SVG viewBox space. */
  svgCentroid: { x: number; y: number };
}

export interface ProjectedIsland {
  points: GeomPoints;
  box: { x: number; y: number; w: number; h: number };
  svgPath: string;
}

export interface SouthChinaSeaInset {
  /** Outer frame on slide (inches). */
  box: { x: number; y: number; w: number; h: number };
  /** Outer frame in SVG viewBox units. */
  svgBox: { x: number; y: number; w: number; h: number };
  islands: ProjectedIsland[];
  /** Short dash segments in slide inches (absolute). */
  dashes: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  /** SVG path for dash segments. */
  dashSvgPath: string;
}

export interface MapProjection {
  provinces: ProjectedProvince[];
  viewBox: { minX: number; minY: number; width: number; height: number };
  /** Map placement on slide in inches. */
  mapRect: { x: number; y: number; w: number; h: number };
  /** South China Sea inset (南海小图). */
  scsInset: SouthChinaSeaInset;
}

/** Default palette: light atlas style (pale land + blue highlights). */
export const DEFAULT_THEME: ThemeColors = {
  mapFill: "EEF2F6",
  mapStroke: "C5CDD6",
  highlight: "4B8FE8",
  highlightStroke: "FFFFFF",
  calloutBg: "FFFFFF",
  calloutText: "1E293B",
  calloutAccent: "4B8FE8",
  slideBg: "FFFFFF",
};

export const DEFAULT_STROKE_WIDTHS: StrokeWidths = {
  map: 0.6,
  highlight: 1.75,
};

export const SIZE_PRESETS: Record<
  Exclude<SlideSizePreset, "custom">,
  { widthIn: number; heightIn: number; label: string }
> = {
  "16:9": { widthIn: 13.333, heightIn: 7.5, label: "16:9 宽屏" },
  "4:3": { widthIn: 10, heightIn: 7.5, label: "4:3 标准" },
  "16:10": { widthIn: 12.5, heightIn: 7.8125, label: "16:10" },
};

export function shortProvinceName(name: string): string {
  return name
    .replace(/维吾尔自治区$/, "")
    .replace(/壮族自治区$/, "")
    .replace(/回族自治区$/, "")
    .replace(/特别行政区$/, "")
    .replace(/自治区$/, "")
    .replace(/省$/, "")
    .replace(/市$/, "");
}
