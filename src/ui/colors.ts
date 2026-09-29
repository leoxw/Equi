/** Normalize hex to RRGGBB uppercase without #. */
export function normHex(color: string): string {
  return color.replace(/^#/, "").toUpperCase();
}

function parseRgb(hex: string): [number, number, number] {
  const h = normHex(hex);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `${clamp(r)}${clamp(g)}${clamp(b)}`;
}

/** Mix a toward b by t (0–1). */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseRgb(a);
  const [br, bg, bb] = parseRgb(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** Soften a color toward the slide background so SCS stays understated. */
export function softScsColors(theme: {
  mapFill: string;
  mapStroke: string;
  slideBg: string;
  calloutText: string;
}): { frameFill: string; frameStroke: string; island: string; islandStroke: string; dash: string } {
  return {
    frameFill: mixHex(theme.slideBg, theme.mapFill, 0.35),
    frameStroke: mixHex(theme.slideBg, theme.mapStroke, 0.55),
    island: mixHex(theme.slideBg, theme.mapFill, 0.55),
    islandStroke: mixHex(theme.slideBg, theme.mapStroke, 0.4),
    // Soft gray dashes — readable on light atlas, understated on dark.
    dash: mixHex(theme.slideBg, theme.calloutText, 0.32),
  };
}
