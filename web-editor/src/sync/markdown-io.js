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

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**',
});
turndown.use(gfm);

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

/** Markdown 字符串 → HTML（供 TipTap） */
export function markdownToHtml(markdown) {
  const src = markdown ?? '';
  if (!src.trim()) return '<p></p>';
  const normalized = convertTabSeparatedTables(src);
  return marked.parse(normalized);
}

/** TipTap/ProseMirror HTML → Markdown 字符串 */
export function htmlToMarkdown(html) {
  if (!html || html === '<p></p>') return '';
  return turndown.turndown(html).trimEnd() + (html.endsWith('\n') ? '' : '\n');
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
