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
  breaks: false,
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
});
turndown.use(gfm);

// 回写 Markdown 时保留段落行首缩进（&nbsp; / 普通空格 / Tab）
// 表格单元格内的 <p> 不能加空行，否则会破坏 GFM 管道表，甚至让 turndown 放弃转换。
turndown.addRule('paragraphKeepIndent', {
  filter: 'p',
  replacement(content, node) {
    const raw = node.textContent || '';
    const lead = (raw.match(/^[\u00a0 \t]+/) || [''])[0].replace(/\u00a0/g, ' ');
    const body = content.replace(/^[\u00a0\s]+/, '').replace(/[\u00a0\s]+$/, '');
    const parent = node.parentNode?.nodeName;
    if (parent === 'TD' || parent === 'TH') {
      return `${lead}${body}`;
    }
    return `\n\n${lead}${body}\n\n`;
  },
});

/**
 * TipTap 表格常带 <colgroup>/<col>，会导致 turndown-plugin-gfm
 * 误判「无表头行」而 keep 整表为 HTML。回写前先剥掉这些装饰。
 */
function normalizeEditorHtmlForMarkdown(html) {
  return String(html ?? '')
    .replace(/<colgroup\b[^>]*>[\s\S]*?<\/colgroup>/gi, '')
    .replace(/<col\b[^>]*\/?>/gi, '');
}

/** 将 <p> 行首空格写成 &nbsp;，避免 HTML 解析/turndown 折叠掉多级缩进 */
function encodeParagraphLeadingSpaces(html) {
  return String(html ?? '').replace(/<p(\s[^>]*)?>(([ \t]|&#32;)+)/gi, (_, attrs = '', spaces) => {
    const encoded = spaces
      .replace(/&#32;/gi, ' ')
      .replace(/ /g, '&nbsp;')
      .replace(/\t/g, '&nbsp;&nbsp;');
    return `<p${attrs || ''}>${encoded}`;
  });
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
  const src = markdown ?? '';
  if (!src.trim()) return '<p></p>';
  const normalized = convertTabSeparatedTables(src);
  return encodeParagraphLeadingSpaces(marked.parse(normalized));
}

/** TipTap/ProseMirror HTML → Markdown 字符串 */
export function htmlToMarkdown(html) {
  if (!html || html === '<p></p>') return '';
  const prepared = encodeParagraphLeadingSpaces(normalizeEditorHtmlForMarkdown(html));
  let md = turndown.turndown(prepared).trimEnd();
  // 清理管道表单元格内残留的多余空白，保持可读
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
