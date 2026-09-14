/**
 * 离线语法高亮：lowlight + highlight.js（按需注册，适配 WKWebView / Electron）。
 */
import { common, createLowlight } from 'lowlight';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import powershell from 'highlight.js/lib/languages/powershell';
import dart from 'highlight.js/lib/languages/dart';
import elixir from 'highlight.js/lib/languages/elixir';
import haskell from 'highlight.js/lib/languages/haskell';
import scala from 'highlight.js/lib/languages/scala';
import latex from 'highlight.js/lib/languages/latex';
import nginx from 'highlight.js/lib/languages/nginx';
import less from 'highlight.js/lib/languages/less';

export const lowlight = createLowlight(common);

// common 未覆盖但对编辑器常用的语言
const extras = {
  dockerfile,
  powershell,
  dart,
  elixir,
  haskell,
  scala,
  latex,
  nginx,
  less,
};

for (const [name, def] of Object.entries(extras)) {
  if (!lowlight.registered(name)) {
    lowlight.register(name, def);
  }
}

// 常见别名 → highlight.js 正式名（registerAlias: { 正式名: 别名 }）
const ALIASES = {
  javascript: ['js', 'jsx', 'mjs', 'cjs'],
  typescript: ['ts', 'tsx'],
  python: ['py'],
  bash: ['sh', 'zsh', 'shell', 'console'],
  yaml: ['yml'],
  xml: ['html', 'htm', 'svg'],
  cpp: ['c++', 'cc', 'cxx'],
  csharp: ['c#', 'cs'],
  objectivec: ['objc', 'objective-c'],
  dockerfile: ['docker'],
  powershell: ['ps1', 'pwsh'],
  markdown: ['md'],
  plaintext: ['text', 'txt', 'plain'],
  go: ['golang'],
  rust: ['rs'],
  kotlin: ['kt'],
  ruby: ['rb'],
  latex: ['tex'],
  // TOML 无独立 grammar，用 ini 近似着色
  ini: ['toml'],
};

for (const [target, aliases] of Object.entries(ALIASES)) {
  if (!lowlight.registered(target)) continue;
  lowlight.registerAlias({ [target]: aliases });
}

/** UI 下拉：主流语言（value 与 fence info string 对齐） */
export const CODE_LANGUAGES = [
  { value: '', label: '纯文本' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'swift', label: 'Swift' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'objectivec', label: 'Objective-C' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'php', label: 'PHP' },
  { value: 'dart', label: 'Dart' },
  { value: 'scala', label: 'Scala' },
  { value: 'haskell', label: 'Haskell' },
  { value: 'elixir', label: 'Elixir' },
  { value: 'bash', label: 'Bash' },
  { value: 'powershell', label: 'PowerShell' },
  { value: 'sql', label: 'SQL' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'scss', label: 'SCSS' },
  { value: 'less', label: 'Less' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'toml', label: 'TOML' },
  { value: 'xml', label: 'XML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'graphql', label: 'GraphQL' },
  { value: 'dockerfile', label: 'Dockerfile' },
  { value: 'makefile', label: 'Makefile' },
  { value: 'nginx', label: 'Nginx' },
  { value: 'ini', label: 'INI' },
  { value: 'latex', label: 'LaTeX' },
  { value: 'r', label: 'R' },
  { value: 'lua', label: 'Lua' },
  { value: 'perl', label: 'Perl' },
  { value: 'diff', label: 'Diff' },
  { value: 'wasm', label: 'WebAssembly' },
];

export function languageLabel(value) {
  const found = CODE_LANGUAGES.find((item) => item.value === (value || ''));
  return found?.label || value || '纯文本';
}
