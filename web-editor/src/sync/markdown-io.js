/**
 * Markdown ↔ HTML 互转（AST/HTML 中转层）。
 * - marked：MD → HTML（驱动 TipTap setContent）
 * - turndown + GFM：HTML → MD（从 TipTap 回写 CodeMirror）
 *
 * 说明：@tiptap/extension-markdown 在不同大版本 API 不稳定；
 * 使用成熟的 MD↔HTML 管线可保证离线包体积可控、行为可预测。
 */

import { marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

marked.setOptions({
  gfm: true,
  // 单个换行也渲染为 <br>，否则大纲式纯文本会被挤成一段
  breaks: true,
  pedantic: false,
});

// 关闭「行首 4 空格 / Tab → 缩进代码块」：允许多级空格缩进，代码块仅认围栏 ```。
marked.use({
  tokenizer: {
    code() {
      return undefined;
    },
  },
});

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**',
  // turndown 实际输出为 options.br + '\n'；置空即可得到单个换行
  br: '',
});
turndown.use(gfm);

// 缩进导引 → Markdown 双空格（每级 2 空格）
turndown.addRule('equiIndentGuide', {
  filter(node) {
    return (
      node.nodeName === 'SPAN' &&
      (node.classList?.contains('equi-indent-guide') || node.hasAttribute?.('data-equi-indent'))
    );
  },
  replacement(_content, node) {
    const raw = node.getAttribute?.('data-equi-indent') || '0';
    const level = parseInt(raw, 10);
    const n = Number.isFinite(level) && level > 0 ? Math.min(level, 32) : 0;
    return '  '.repeat(n);
  },
});

// 回写 Markdown 时保留段落缩进与软换行。
// 表格单元格内的 <p> 不能加空行，否则会破坏 GFM 管道表。
turndown.addRule('paragraphKeepIndent', {
  filter: 'p',
  replacement(content, node) {
    let body = String(content ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/&nbsp;/gi, ' ');
    const parent = node.parentNode?.nodeName;
    if (parent === 'TD' || parent === 'TH') {
      return body.replace(/\n+/g, ' ').trim();
    }
    // 去掉首尾多余空行，但保留行内换行与行首缩进
    body = body.replace(/^\n+/, '').replace(/\n+$/, '');
    return `\n\n${body}\n\n`;
  },
});

/**
 * TipTap 表格常带 <colgroup>/<col>，会导致 turndown-plugin-gfm
 * 误判「无表头行」而 keep 整表为 HTML。回写前先剥掉这些装饰。
 */
function normalizeEditorHtmlForMarkdown(html) {
  return String(html ?? '')
    .replace(/<colgroup\b[^>]*>[\s\S]*?<\/colgroup>/gi, '')
    .replace(/<col\b[^>]*\/?>/gi, '')
    // TipTap 空段落占位 br，回写时不应变成多余空行
    .replace(/<br[^>]*class="[^"]*ProseMirror-trailingBreak[^"]*"[^>]*>/gi, '');
}

/** 把一段前导空白写成缩进导引（每 2 空格 = 1 级 = 渲染 2em ≈ 两汉字宽） */
function encodeLeadingSpaces(spaces) {
  const normalized = String(spaces ?? '')
    .replace(/&#32;/gi, ' ')
    .replace(/\t/g, '  ');
  const level = Math.floor(normalized.length / 2);
  const rest = normalized.length % 2;
  if (level <= 0) {
    return rest ? '&nbsp;' : '';
  }
  // 放入零宽字符，避免 turndown 跳过空 span（否则回写会丢掉缩进）
  const guide = `<span class="equi-indent-guide" data-equi-indent="${level}" style="--equi-indent-level: ${level}" contenteditable="false">\u200b</span>`;
  return rest ? `${guide}&nbsp;` : guide;
}

/**
 * 保留可视缩进：
 * - <p> 行首空格
 * - <br> 后的行首空格（breaks:true 产生的软换行大纲）
 */
function encodeVisualWhitespace(html) {
  return String(html ?? '')
    .replace(/<p(\s[^>]*)?>(([ \t]|&#32;)+)/gi, (_, attrs = '', spaces) => {
      return `<p${attrs || ''}>${encodeLeadingSpaces(spaces)}`;
    })
    .replace(/(<br\s*\/?>)(([ \t]|&#32;)+)/gi, (_, br, spaces) => {
      return `${br}${encodeLeadingSpaces(spaces)}`;
    });
}

/** 解码常见 HTML 实体（表格单元格纯文本） */
function decodeBasicEntities(text) {
  return String(text ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

/** 从单元格 HTML 提取单行纯文本 */
function cellHtmlToText(cellHtml) {
  return decodeBasicEntities(
    String(cellHtml ?? '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/p>\s*<p\b[^>]*>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

/**
 * 将单个 <table>…</table> 强制转为 GFM 管道表（不依赖 turndown-gfm 表头判定）。
 */
export function htmlTableToGfm(tableHtml) {
  const rows = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRe.exec(tableHtml))) {
    const cells = [];
    const cellRe = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(trMatch[1]))) {
      cells.push(cellHtmlToText(cellMatch[2]));
    }
    if (cells.length > 0) rows.push(cells);
  }
  if (rows.length === 0) return '';

  const width = Math.max(...rows.map((r) => r.length));
  const normalized = rows.map((row) => {
    const next = row.slice();
    while (next.length < width) next.push('');
    return next;
  });

  const header = normalized[0];
  const sep = header.map(() => '---');
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ];
  return lines.join('\n');
}

/**
 * 把 HTML / Markdown 中残留的 <table> 块全部换成 GFM 管道表。
 * 用于：1) TipTap 回写 2) 打开已含 HTML 表的旧文档时清洗
 */
export function convertHtmlTablesToGfm(input) {
  const src = String(input ?? '');
  if (!/<table\b/i.test(src)) return src;
  return src
    .replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => {
      const gfm = htmlTableToGfm(table);
      return gfm ? `\n\n${gfm}\n\n` : '';
    })
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * 回写前：先用占位符抽走所有 <table>，避免 turndown keep 成 HTML。
 * 占位符避免下划线（turndown 会转成 \_）。
 * @returns {{ html: string, tables: string[] }}
 */
function extractTablesAsPlaceholders(html) {
  const tables = [];
  const next = String(html ?? '').replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => {
    const idx = tables.length;
    tables.push(htmlTableToGfm(table));
    return `<p>EQUITABLEPLACEHOLDER${idx}</p>`;
  });
  return { html: next, tables };
}

function restoreTablePlaceholders(markdown, tables) {
  let md = String(markdown ?? '');
  tables.forEach((tableMd, idx) => {
    const token = `EQUITABLEPLACEHOLDER${idx}`;
    const escaped = token.replace(/_/g, '\\_'); // 兼容旧占位符
    const block = tableMd ? `\n\n${tableMd}\n\n` : '\n\n';
    const replacement = block.trim() ? block.trim() : '';
    md = md.split(token).join(replacement);
    md = md.split(escaped).join(replacement);
  });
  return md.replace(/\n{3,}/g, '\n\n');
}

/** 将行首 / <br> 后空格写成 &nbsp;，避免 HTML 解析与 ProseMirror 折叠缩进 */
function encodeParagraphLeadingSpaces(html) {
  return encodeVisualWhitespace(html);
}

// 保留富文本色/下划线/高亮（标准 Markdown 无对应语法，落盘为内联 HTML）
turndown.addRule('equiColoredSpan', {
  filter(node) {
    return (
      node.nodeName === 'SPAN' &&
      node.style &&
      typeof node.style.color === 'string' &&
      node.style.color.length > 0
    );
  },
  replacement(content, node) {
    const color = node.style.color;
    return `<span style="color: ${color}">${content}</span>`;
  },
});

turndown.addRule('equiUnderline', {
  filter: ['u'],
  replacement(content) {
    return `<u>${content}</u>`;
  },
});

turndown.addRule('equiHighlight', {
  filter(node) {
    return node.nodeName === 'MARK';
  },
  replacement(content, node) {
    const bg = node.style?.backgroundColor;
    if (bg) return `<mark style="background-color: ${bg}">${content}</mark>`;
    return `<mark>${content}</mark>`;
  },
});

/**
 * 将连续的制表符分隔行（TSV）转成 GFM 管道表格，便于 marked / TipTap 渲染。
 * 跳过围栏代码块；不改写已有 `|` 管道表。
 */
export function convertTabSeparatedTables(markdown) {
  const src = markdown ?? '';
  if (!src.includes('\t')) return src;

  const lines = src.split('\n');
  const out = [];
  let inFence = false;
  let i = 0;

  const escapeCell = (cell) =>
    String(cell ?? '')
      .replace(/\|/g, '\\|')
      .replace(/\r/g, '');

  while (i < lines.length) {
    const line = lines[i];
    const trimmedStart = line.trimStart();

    if (/^```/.test(trimmedStart)) {
      inFence = !inFence;
      out.push(line);
      i += 1;
      continue;
    }

    if (inFence) {
      out.push(line);
      i += 1;
      continue;
    }

    const canStartTable =
      line.includes('\t') &&
      !trimmedStart.startsWith('|') &&
      trimmedStart.length > 0;

    if (canStartTable) {
      const block = [];
      let j = i;
      while (j < lines.length) {
        const cur = lines[j];
        const curTrim = cur.trimStart();
        if (/^```/.test(curTrim)) break;
        if (!cur.includes('\t') || curTrim.startsWith('|') || curTrim.length === 0) {
          break;
        }
        block.push(cur);
        j += 1;
      }

      const rows = block.map((row) => row.split('\t').map((c) => c.trim()));
      const width = rows[0]?.length ?? 0;
      const sameWidth =
        width >= 2 &&
        rows.length >= 2 &&
        rows.every((r) => r.length === width);

      if (sameWidth) {
        out.push(`| ${rows[0].map(escapeCell).join(' | ')} |`);
        out.push(`| ${rows[0].map(() => '---').join(' | ')} |`);
        for (let r = 1; r < rows.length; r += 1) {
          out.push(`| ${rows[r].map(escapeCell).join(' | ')} |`);
        }
        i = j;
        continue;
      }
    }

    out.push(line);
    i += 1;
  }

  return out.join('\n');
}

/**
 * 从 Markdown 中提取制表符分隔表（与 convertTabSeparatedTables 判定一致）。
 * @returns {{ start: number, end: number, rawLines: string[], cells: string[][] }[]}
 */
function extractTabSeparatedTables(markdown) {
  const src = markdown ?? '';
  const lines = src.split('\n');
  const tables = [];
  let inFence = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmedStart = line.trimStart();

    if (/^```/.test(trimmedStart)) {
      inFence = !inFence;
      i += 1;
      continue;
    }
    if (inFence) {
      i += 1;
      continue;
    }

    const canStartTable =
      line.includes('\t') &&
      !trimmedStart.startsWith('|') &&
      trimmedStart.length > 0;

    if (canStartTable) {
      const block = [];
      let j = i;
      while (j < lines.length) {
        const cur = lines[j];
        const curTrim = cur.trimStart();
        if (/^```/.test(curTrim)) break;
        if (!cur.includes('\t') || curTrim.startsWith('|') || curTrim.length === 0) {
          break;
        }
        block.push(cur);
        j += 1;
      }

      const cells = block.map((row) => row.split('\t').map((c) => c.trim()));
      const width = cells[0]?.length ?? 0;
      const sameWidth =
        width >= 2 &&
        cells.length >= 2 &&
        cells.every((r) => r.length === width);

      if (sameWidth) {
        tables.push({ start: i, end: j, rawLines: block, cells });
        i = j;
        continue;
      }
    }

    i += 1;
  }

  return tables;
}

const GFM_SEP_RE = /^\|?[\t ]*:?-+:?[\t ]*(\|[\t ]*:?-+:?[\t ]*)+\|?[\t ]*$/;

function parseGfmRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim().replace(/\\\|/g, '|'));
}

/**
 * 从 Markdown 中提取 GFM 管道表（含分隔行）。
 * @returns {{ start: number, end: number, cells: string[][] }[]}
 */
function extractGfmPipeTables(markdown) {
  const lines = (markdown ?? '').split('\n');
  const tables = [];
  let inFence = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      i += 1;
      continue;
    }
    if (inFence) {
      i += 1;
      continue;
    }

    if (
      trimmed.startsWith('|') &&
      i + 1 < lines.length &&
      GFM_SEP_RE.test(lines[i + 1].trim())
    ) {
      const header = parseGfmRow(lines[i]);
      if (header.length < 2) {
        i += 1;
        continue;
      }
      const cells = [header];
      let j = i + 2;
      while (j < lines.length) {
        const t = lines[j].trim();
        if (!t.startsWith('|') || GFM_SEP_RE.test(t)) break;
        const row = parseGfmRow(lines[j]);
        if (row.length !== header.length) break;
        cells.push(row);
        j += 1;
      }
      if (cells.length >= 2) {
        tables.push({ start: i, end: j, cells });
      }
      i = j;
      continue;
    }

    i += 1;
  }

  return tables;
}

function cellsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r += 1) {
    if (a[r].length !== b[r].length) return false;
    for (let c = 0; c < a[r].length; c += 1) {
      if (a[r][c] !== b[r][c]) return false;
    }
  }
  return true;
}

/**
 * 用制表符重建表格行：未改动的格子尽量保留原 raw 片段，改动过的格子用新内容。
 */
function rebuildTabTable(rawLines, prevCells, nextCells) {
  if (cellsEqual(prevCells, nextCells)) {
    return rawLines;
  }
  return nextCells.map((row, r) =>
    row
      .map((cell, c) => {
        const prev = prevCells[r]?.[c];
        if (prev === cell && rawLines[r] != null) {
          const parts = rawLines[r].split('\t');
          if (parts.length === row.length) return parts[c];
        }
        return cell;
      })
      .join('\t'),
  );
}

/**
 * WYSIWYG→源码回写时：若上一版源码是制表符表，而 turndown 写成了 GFM 管道表，
 * 则按形状匹配并还原为制表符分隔，避免渲染过程污染纯文本源文件。
 */
export function preserveTabSeparatedTables(previousMarkdown, nextMarkdown) {
  const prev = previousMarkdown ?? '';
  const next = nextMarkdown ?? '';
  if (!prev.includes('\t')) return next;

  const tabTables = extractTabSeparatedTables(prev);
  if (tabTables.length === 0) return next;

  const gfmTables = extractGfmPipeTables(next);
  if (gfmTables.length === 0) return next;

  const usedPrev = new Set();
  const replacements = [];

  for (const gfm of gfmTables) {
    const rows = gfm.cells.length;
    const cols = gfm.cells[0]?.length ?? 0;
    let matchIdx = -1;
    for (let p = 0; p < tabTables.length; p += 1) {
      if (usedPrev.has(p)) continue;
      const tab = tabTables[p];
      if (tab.cells.length === rows && tab.cells[0].length === cols) {
        matchIdx = p;
        break;
      }
    }
    if (matchIdx < 0) continue;
    usedPrev.add(matchIdx);
    const tab = tabTables[matchIdx];
    replacements.push({
      start: gfm.start,
      end: gfm.end,
      lines: rebuildTabTable(tab.rawLines, tab.cells, gfm.cells),
    });
  }

  if (replacements.length === 0) return next;

  const nextLines = next.split('\n');
  // 从后往前替换，避免行号偏移
  replacements.sort((a, b) => b.start - a.start);
  for (const rep of replacements) {
    nextLines.splice(rep.start, rep.end - rep.start, ...rep.lines);
  }
  return nextLines.join('\n');
}

/** Markdown 字符串 → HTML（供 TipTap） */
export function markdownToHtml(markdown) {
  const src = convertHtmlTablesToGfm(markdown ?? '');
  if (!src.trim()) return '<p></p>';
  const normalized = convertTabSeparatedTables(src);
  return encodeParagraphLeadingSpaces(marked.parse(normalized));
}

/** TipTap/ProseMirror HTML → Markdown 字符串 */
export function htmlToMarkdown(html) {
  if (!html || html === '<p></p>') return '';
  // 强制抽走表格再 turndown，彻底避免 keep 成 HTML
  const stripped = normalizeEditorHtmlForMarkdown(html);
  const { html: withoutTables, tables } = extractTablesAsPlaceholders(stripped);
  const prepared = encodeParagraphLeadingSpaces(withoutTables);
  let md = turndown.turndown(prepared).trimEnd();
  md = restoreTablePlaceholders(md, tables);
  // 兜底：若仍残留 <table>，再强制转换
  md = convertHtmlTablesToGfm(md);
  md = tidyGfmPipeTables(md);
  return md + (html.endsWith('\n') ? '' : '\n');
}

/** 压缩 GFM 管道表单元格内外多余空白/空行 */
function tidyGfmPipeTables(markdown) {
  const lines = String(markdown ?? '').split('\n');
  const out = [];
  for (const line of lines) {
    if (!/^\s*\|/.test(line) || !/\|/.test(line.slice(1))) {
      out.push(line);
      continue;
    }
    // 跳过纯分隔行
    if (/^\s*\|?\s*:?-{3,}.*\|/.test(line)) {
      out.push(line.replace(/\|\s+/g, '| ').replace(/\s+\|/g, ' |').replace(/^\s+/, ''));
      continue;
    }
    const cells = line
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map((c) => c.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim());
    out.push(`| ${cells.join(' | ')} |`);
  }
  return out.join('\n');
}

/** 字数统计（与 Swift 侧粗略策略对齐） */
export function countStats(text) {
  const content = text ?? '';
  const trimmed = content.trim();
  if (!trimmed) return { wordCount: 0, characterCount: 0 };

  const characterCount = [...content].length;
  const latinWords = trimmed.split(/\s+/).filter(Boolean).length;
  const cjk = (trimmed.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff]/g) || [])
    .join('').length;
  return { wordCount: Math.max(latinWords, cjk), characterCount };
}
