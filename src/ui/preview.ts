import type { AppConfig, MapProjection } from "../types";
import { shortProvinceName } from "../types";
import { placeCallout } from "../map/project";
import { softScsColors } from "./colors";

export function renderPreview(
  container: HTMLElement,
  projection: MapProjection,
  config: AppConfig,
): void {
  const { viewBox, scsInset } = projection;
  const selected = new Set(config.selectedOrder);
  const svgScale = viewBox.width / config.size.widthIn;
  const theme = config.theme;
  const scs = softScsColors(theme);

  const paths = projection.provinces
    .map((p) => {
      const hi = selected.has(p.adcode);
      const fill = `#${hi ? theme.highlight : theme.mapFill}`;
      const stroke = `#${hi ? theme.highlightStroke : theme.mapStroke}`;
      return `<path data-adcode="${p.adcode}" class="prov${hi ? " is-hot" : ""}" fill="${fill}" stroke="${stroke}" stroke-width="${hi ? 1.1 : 0.6}" d="${p.svgPath}">
        <title>${p.name}</title>
      </path>`;
    })
    .join("");

  const islandPaths = scsInset.islands
    .map(
      (isle) =>
        `<path class="scs-island" fill="#${scs.island}" stroke="#${scs.islandStroke}" stroke-width="0.35" d="${isle.svgPath}" />`,
    )
    .join("");

  const markers = config.selectedOrder
    .map((adcode, index) => {
      const p = projection.provinces.find((x) => x.adcode === adcode);
      const tip = config.tips[adcode];
      if (!p || !tip) return "";
      const box = placeCallout(
        p.centroid,
        config.size.widthIn,
        config.size.heightIn,
        index,
        config.selectedOrder.length,
      );
      const sx = box.x * svgScale;
      const sy = box.y * svgScale;
      const sw = box.w * svgScale;
      const sh = box.h * svgScale;
      const fields = tip.fields
        .filter((f) => f.key.trim() || f.value.trim())
        .map(
          (f) =>
            `<div class="pv-row"><span>${escapeHtml(f.key || "指标")}</span><strong>${escapeHtml(f.value || "—")}</strong></div>`,
        )
        .join("");
      return `<foreignObject x="${sx}" y="${sy}" width="${sw}" height="${sh}" class="pv-callout-fo">
        <div xmlns="http://www.w3.org/1999/xhtml" class="pv-callout" style="background:#${theme.calloutBg};border-color:#${theme.calloutAccent};color:#${theme.calloutText}">
          <div class="pv-title" style="color:#${theme.highlightStroke}">${escapeHtml(tip.title || shortProvinceName(tip.name))}</div>
          ${fields}
        </div>
      </foreignObject>`;
    })
    .join("");

  const sea0 = mixPreviewSea(theme.slideBg, 0.08);
  const sea1 = mixPreviewSea(theme.slideBg, 0.18);

  container.innerHTML = `
    <svg class="map-svg" viewBox="${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}" role="img" aria-label="中国分省地图预览">
      <defs>
        <linearGradient id="sea" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#${sea0}"/>
          <stop offset="100%" stop-color="#${sea1}"/>
        </linearGradient>
        <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.2" result="b"/>
          <feMerge>
            <feMergeNode in="b"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      <rect x="${viewBox.minX}" y="${viewBox.minY}" width="${viewBox.width}" height="${viewBox.height}" fill="#${theme.slideBg}"/>
      <g class="provinces">${paths}</g>
      <g class="scs-inset">
        <rect
          class="scs-frame"
          x="${scsInset.svgBox.x}"
          y="${scsInset.svgBox.y}"
          width="${scsInset.svgBox.w}"
          height="${scsInset.svgBox.h}"
          rx="1.2"
          fill="#${scs.frameFill}"
          stroke="#${scs.frameStroke}"
          stroke-width="0.9"
          opacity="0.92"
        />
        ${islandPaths}
        <path class="scs-dash" d="${scsInset.dashSvgPath}" fill="none" stroke="#${scs.dash}" stroke-width="0.85" stroke-linecap="round" opacity="0.55" />
      </g>
      ${markers}
    </svg>
  `;
}

function mixPreviewSea(slideBg: string, lift: number): string {
  // Slightly lift slide bg for subtle sea gradient without fighting theme.
  const h = slideBg.replace(/^#/, "");
  const r = Math.min(255, parseInt(h.slice(0, 2), 16) + Math.round(40 * lift));
  const g = Math.min(255, parseInt(h.slice(2, 4), 16) + Math.round(55 * lift));
  const b = Math.min(255, parseInt(h.slice(4, 6), 16) + Math.round(70 * lift));
  return [r, g, b]
    .map((n) => n.toString(16).padStart(2, "0").toUpperCase())
    .join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
