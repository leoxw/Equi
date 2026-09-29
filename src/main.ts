import "./styles.css";
import chinaGeo from "./map/china-provinces.json";
import type { FeatureCollection } from "geojson";
import {
  DEFAULT_STROKE_WIDTHS,
  DEFAULT_THEME,
  SIZE_PRESETS,
  type AppConfig,
  type DataField,
  type SlideSizePreset,
} from "./types";
import { loadProvinceMeta, projectChinaMap } from "./map/project";
import { renderPreview } from "./ui/preview";
import { buildPptxBlob } from "./pptx/build-slide";
import { injectAnimations } from "./pptx/inject-animations";

const geo = chinaGeo as FeatureCollection;
const provinceMeta = loadProvinceMeta(geo);

function uid(prefix = "f"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function defaultFields(): DataField[] {
  return [{ id: uid(), key: "重发授权", value: "" }];
}

function createInitialConfig(): AppConfig {
  const preset: SlideSizePreset = "16:9";
  const size = SIZE_PRESETS[preset];
  // 默认数据：重发授权（江苏 / 浙江 / 福建）
  const defaults = ["320000", "330000", "350000"];
  const sample: Record<string, string> = {
    "320000": "31081",
    "330000": "19409",
    "350000": "74838",
  };
  const tips: AppConfig["tips"] = {};
  for (const adcode of defaults) {
    const meta = provinceMeta.find((p) => p.adcode === adcode);
    if (!meta) continue;
    tips[adcode] = {
      adcode,
      name: meta.name,
      title: meta.name.replace(/省$/, ""),
      fields: [{ id: uid(), key: "重发授权", value: sample[adcode] ?? "" }],
    };
  }

  return {
    size: { preset, widthIn: size.widthIn, heightIn: size.heightIn },
    title: "重发授权区域分布",
    selectedOrder: defaults.filter((c) => tips[c]),
    tips,
    theme: { ...DEFAULT_THEME },
    strokeWidths: { ...DEFAULT_STROKE_WIDTHS },
  };
}

const state = createInitialConfig();
const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <div class="app-shell">
    <header class="brand">
      <div class="brand-mark">Equi</div>
      <p>快速生成一页中国分省地图 PPTX：勾选省份、填写提示数据，放映时依次高亮闪烁并弹出数据框。</p>
    </header>
    <div class="layout">
      <aside class="panel" id="config-panel"></aside>
      <section class="panel panel-preview">
        <h2>预览</h2>
        <div class="preview-stage" id="preview"></div>
        <div class="preview-meta">
          <span id="size-label"></span>
          <span id="selection-label"></span>
        </div>
      </section>
    </div>
  </div>
`;

const configPanel = document.querySelector<HTMLElement>("#config-panel")!;
const previewEl = document.querySelector<HTMLElement>("#preview")!;
const sizeLabel = document.querySelector<HTMLElement>("#size-label")!;
const selectionLabel = document.querySelector<HTMLElement>("#selection-label")!;

let searchQuery = "";

function renderConfig(): void {
  const custom = state.size.preset === "custom";
  configPanel.innerHTML = `
    <h2>页面配置</h2>
    <div class="field">
      <label for="deck-title">幻灯片标题</label>
      <input id="deck-title" type="text" value="${escapeAttr(state.title)}" />
    </div>
    <div class="field">
      <label>幻灯片尺寸</label>
      <div class="chip-row" id="size-chips">
        ${Object.entries(SIZE_PRESETS)
          .map(
            ([key, val]) =>
              `<button type="button" class="chip${state.size.preset === key ? " is-active" : ""}" data-size="${key}">${val.label}</button>`,
          )
          .join("")}
        <button type="button" class="chip${custom ? " is-active" : ""}" data-size="custom">自定义</button>
      </div>
    </div>
    <div class="field size-row" id="custom-size" style="${custom ? "" : "display:none"}">
      <div>
        <label for="w-in">宽（英寸）</label>
        <input id="w-in" type="number" min="5" max="30" step="0.001" value="${state.size.widthIn}" />
      </div>
      <div>
        <label for="h-in">高（英寸）</label>
        <input id="h-in" type="number" min="4" max="20" step="0.001" value="${state.size.heightIn}" />
      </div>
    </div>

    <div class="field">
      <label>主题色</label>
      <div class="color-grid">
        ${colorField("mapFill", "地图底色", state.theme.mapFill)}
        ${colorField("mapStroke", "省界线", state.theme.mapStroke)}
        ${colorField("highlight", "高亮填充", state.theme.highlight)}
        ${colorField("highlightStroke", "高亮边界", state.theme.highlightStroke)}
        ${colorField("calloutBg", "数据框底", state.theme.calloutBg)}
        ${colorField("calloutAccent", "数据框描边", state.theme.calloutAccent)}
        ${colorField("slideBg", "幻灯片底", state.theme.slideBg)}
      </div>
    </div>

    <div class="field">
      <label>边界粗细（pt）</label>
      <div class="width-grid">
        ${widthField("map", "普通省界", state.strokeWidths.map)}
        ${widthField("highlight", "高亮省界", state.strokeWidths.highlight)}
      </div>
    </div>

    <div class="field">
      <label>选择高亮省份</label>
      <input class="search-box" id="prov-search" type="text" placeholder="搜索省份…" value="${escapeAttr(searchQuery)}" />
      <div class="province-list" id="province-list"></div>
    </div>

    <div class="field">
      <label>提示数据（介绍顺序）</label>
      <div class="selected-block" id="selected-block"></div>
    </div>

    <div class="actions">
      <button class="btn-primary" id="export-btn" type="button">生成并下载 PPTX</button>
      <p class="hint">放映时每点击一次：当前省脉冲闪烁，随后弹出数据框。未勾选省份仅作为底图。</p>
    </div>
  `;

  bindConfigEvents();
  renderProvinceList();
  renderSelectedBlock();
}

function colorField(key: string, label: string, value: string): string {
  return `<label class="color-field">${label}<input type="color" data-theme="${key}" value="#${value}" /></label>`;
}

function widthField(key: "map" | "highlight", label: string, value: number): string {
  return `<label class="width-field">
    <span class="width-label">${label}<strong data-width-val="${key}">${value.toFixed(2)}</strong></span>
    <input type="range" min="0.25" max="4" step="0.05" data-stroke-width="${key}" value="${value}" />
  </label>`;
}

function renderProvinceList(): void {
  const list = document.querySelector<HTMLElement>("#province-list");
  if (!list) return;
  const q = searchQuery.trim();
  const items = provinceMeta.filter((p) => !q || p.name.includes(q));
  list.innerHTML = items
    .map((p) => {
      const checked = state.selectedOrder.includes(p.adcode);
      return `<label class="province-item">
        <input type="checkbox" data-adcode="${p.adcode}" ${checked ? "checked" : ""} />
        <span>${p.name}</span>
      </label>`;
    })
    .join("");

  list.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((el) => {
    el.addEventListener("change", () => {
      const adcode = el.dataset.adcode!;
      if (el.checked) {
        if (!state.selectedOrder.includes(adcode)) {
          state.selectedOrder.push(adcode);
          const meta = provinceMeta.find((p) => p.adcode === adcode)!;
          state.tips[adcode] = {
            adcode,
            name: meta.name,
            title: meta.name.replace(/(省|市|自治区|特别行政区)$/g, ""),
            fields: defaultFields(),
          };
        }
      } else {
        state.selectedOrder = state.selectedOrder.filter((c) => c !== adcode);
      }
      renderSelectedBlock();
      refreshPreview();
    });
  });
}

function renderSelectedBlock(): void {
  const block = document.querySelector<HTMLElement>("#selected-block");
  if (!block) return;
  if (state.selectedOrder.length === 0) {
    block.innerHTML = `<p class="hint">尚未选择省份。勾选后可编辑弹出数据。</p>`;
    return;
  }

  block.innerHTML = state.selectedOrder
    .map((adcode, index) => {
      const tip = state.tips[adcode];
      if (!tip) return "";
      const fields = tip.fields
        .map(
          (f) => `
        <div class="kv-row" data-field="${f.id}">
          <input data-k="key" placeholder="参数名" value="${escapeAttr(f.key)}" />
          <input data-k="value" placeholder="数值" value="${escapeAttr(f.value)}" />
          <button type="button" class="icon-btn danger" data-act="rm-field" title="删除">×</button>
        </div>`,
        )
        .join("");
      return `
      <article class="selected-card" data-adcode="${adcode}">
        <header>
          <h3>${index + 1}. ${tip.name}</h3>
          <div>
            <button type="button" class="icon-btn" data-act="up" title="上移">↑</button>
            <button type="button" class="icon-btn" data-act="down" title="下移">↓</button>
            <button type="button" class="icon-btn danger" data-act="remove" title="移除">×</button>
          </div>
        </header>
        <div class="field" style="margin-bottom:8px">
          <label>弹出标题</label>
          <input data-act="title" type="text" value="${escapeAttr(tip.title)}" />
        </div>
        <div class="kv-list">${fields}</div>
        <button type="button" class="chip" data-act="add-field" style="margin-top:8px">+ 添加参数</button>
      </article>`;
    })
    .join("");

  block.querySelectorAll<HTMLElement>(".selected-card").forEach((card) => {
    const adcode = card.dataset.adcode!;
    card.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.act;
        if (act === "remove") {
          state.selectedOrder = state.selectedOrder.filter((c) => c !== adcode);
          delete state.tips[adcode];
          renderProvinceList();
          renderSelectedBlock();
          refreshPreview();
          return;
        }
        if (act === "up" || act === "down") {
          const i = state.selectedOrder.indexOf(adcode);
          const j = act === "up" ? i - 1 : i + 1;
          if (j < 0 || j >= state.selectedOrder.length) return;
          const arr = state.selectedOrder.slice();
          [arr[i], arr[j]] = [arr[j], arr[i]];
          state.selectedOrder = arr;
          renderSelectedBlock();
          refreshPreview();
          return;
        }
        if (act === "add-field") {
          state.tips[adcode].fields.push({ id: uid(), key: "", value: "" });
          renderSelectedBlock();
          refreshPreview();
          return;
        }
        if (act === "rm-field") {
          const row = btn.closest<HTMLElement>(".kv-row");
          const fid = row?.dataset.field;
          if (!fid) return;
          state.tips[adcode].fields = state.tips[adcode].fields.filter((f) => f.id !== fid);
          renderSelectedBlock();
          refreshPreview();
        }
      });
    });

    card.querySelector<HTMLInputElement>("input[data-act=title]")?.addEventListener("input", (e) => {
      state.tips[adcode].title = (e.target as HTMLInputElement).value;
      refreshPreview();
    });

    card.querySelectorAll<HTMLElement>(".kv-row").forEach((row) => {
      const fid = row.dataset.field!;
      row.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
        input.addEventListener("input", () => {
          const field = state.tips[adcode].fields.find((f) => f.id === fid);
          if (!field) return;
          const k = input.dataset.k as "key" | "value";
          field[k] = input.value;
          refreshPreview();
        });
      });
    });
  });
}

function bindConfigEvents(): void {
  document.querySelector<HTMLInputElement>("#deck-title")?.addEventListener("input", (e) => {
    state.title = (e.target as HTMLInputElement).value;
  });

  document.querySelectorAll<HTMLButtonElement>("#size-chips .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.size as SlideSizePreset;
      state.size.preset = key;
      if (key !== "custom") {
        state.size.widthIn = SIZE_PRESETS[key].widthIn;
        state.size.heightIn = SIZE_PRESETS[key].heightIn;
      }
      renderConfig();
      refreshPreview();
    });
  });

  document.querySelector<HTMLInputElement>("#w-in")?.addEventListener("change", (e) => {
    state.size.widthIn = Math.max(5, Number((e.target as HTMLInputElement).value) || 13.333);
    refreshPreview();
  });
  document.querySelector<HTMLInputElement>("#h-in")?.addEventListener("change", (e) => {
    state.size.heightIn = Math.max(4, Number((e.target as HTMLInputElement).value) || 7.5);
    refreshPreview();
  });

  document.querySelectorAll<HTMLInputElement>("input[data-theme]").forEach((input) => {
    const apply = () => {
      const key = input.dataset.theme as keyof typeof state.theme;
      state.theme[key] = input.value.replace("#", "").toUpperCase();
      applyThemeToCss();
      refreshPreview();
    };
    input.addEventListener("input", apply);
    input.addEventListener("change", apply);
  });

  document.querySelectorAll<HTMLInputElement>("input[data-stroke-width]").forEach((input) => {
    const apply = () => {
      const key = input.dataset.strokeWidth as "map" | "highlight";
      const val = Math.min(4, Math.max(0.25, Number(input.value) || DEFAULT_STROKE_WIDTHS[key]));
      state.strokeWidths[key] = val;
      const label = document.querySelector<HTMLElement>(`[data-width-val="${key}"]`);
      if (label) label.textContent = val.toFixed(2);
      refreshPreview();
    };
    input.addEventListener("input", apply);
    input.addEventListener("change", apply);
  });

  document.querySelector<HTMLInputElement>("#prov-search")?.addEventListener("input", (e) => {
    searchQuery = (e.target as HTMLInputElement).value;
    renderProvinceList();
  });

  document.querySelector<HTMLButtonElement>("#export-btn")?.addEventListener("click", () => {
    void exportPptx();
  });
}

function applyThemeToCss(): void {
  const t = state.theme;
  const root = document.documentElement.style;
  root.setProperty("--hot", `#${t.highlight}`);
  root.setProperty("--map-fill", `#${t.mapFill}`);
  root.setProperty("--map-stroke", `#${t.mapStroke}`);
  root.setProperty("--slide-bg", `#${t.slideBg}`);
  root.setProperty("--callout-bg", `#${t.calloutBg}`);
  root.setProperty("--callout-text", `#${t.calloutText}`);
  root.setProperty("--callout-accent", `#${t.calloutAccent}`);
}

function refreshPreview(): void {
  const projection = projectChinaMap(geo, state.size.widthIn, state.size.heightIn);
  renderPreview(previewEl, projection, state);
  applyProvinceClickToggle();
  sizeLabel.textContent = `${state.size.widthIn.toFixed(3)}" × ${state.size.heightIn.toFixed(3)}" · ${state.size.preset}`;
  selectionLabel.textContent = `已选 ${state.selectedOrder.length} 省`;
}

function applyProvinceClickToggle(): void {
  previewEl.querySelectorAll<SVGPathElement>("path.prov").forEach((path) => {
    path.addEventListener("click", () => {
      const adcode = path.dataset.adcode!;
      const checkbox = configPanel.querySelector<HTMLInputElement>(
        `input[type=checkbox][data-adcode="${adcode}"]`,
      );
      if (checkbox) {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event("change"));
      }
    });
  });
}

async function exportPptx(): Promise<void> {
  const btn = document.querySelector<HTMLButtonElement>("#export-btn");
  if (!btn) return;
  if (state.selectedOrder.length === 0) {
    alert("请先选择至少一个要高亮介绍的省份。");
    return;
  }
  btn.classList.add("is-busy");
  btn.textContent = "正在生成…";
  try {
    const projection = projectChinaMap(geo, state.size.widthIn, state.size.heightIn);
    const { blob, meta } = await buildPptxBlob(state, projection);
    const animated = await injectAnimations(blob, meta, state.selectedOrder);
    downloadBlob(animated, `${sanitizeFilename(state.title || "china-map")}.pptx`);
    btn.textContent = "已下载 ✓";
    setTimeout(() => {
      btn.textContent = "生成并下载 PPTX";
      btn.classList.remove("is-busy");
    }, 1200);
  } catch (err) {
    console.error(err);
    alert(`生成失败：${err instanceof Error ? err.message : String(err)}`);
    btn.textContent = "生成并下载 PPTX";
    btn.classList.remove("is-busy");
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60) || "china-map";
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

renderConfig();
applyThemeToCss();
refreshPreview();
