#!/usr/bin/env node
/*
 * csp-hash.mjs —— 重新计算 index.html 内联 <style> / <script> 块的 sha256，
 * 并把结果写回 Content-Security-Policy 的 meta 标签。
 *
 * 为什么需要它：
 *   本工具的 CSP 用哈希白名单锁定内联脚本（script-src 'sha256-…'），
 *   因此**任何**对脚本或样式正文的改动（哪怕多一个空格）都会让哈希失配，
 *   浏览器会直接拒绝执行 → 页面白屏。
 *   改完 index.html 后必须跑一次本脚本，否则工具会静默失效。
 *
 * 用法：
 *   node tools/csp-hash.mjs index.html
 *
 * 依赖：仅 Node 内置模块。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const file = process.argv[2];
if (!file) {
  console.error('用法: node tools/csp-hash.mjs <index.html>');
  process.exit(1);
}

const html = readFileSync(file, 'utf8');

/** 收集没有 src 属性的内联块（script/style 都是 raw text 元素） */
function collect(tag) {
  const re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    if (tag === 'script' && /\ssrc\s*=/.test(attrs)) continue; // 外链脚本另有处理
    out.push({ body: m[2] });
  }
  return out;
}

/** 解析完整性自检：标签成对数必须和正则收集数一致，否则说明正文里有裸 </script> 之类 */
function selfCheck(tag, collected) {
  const open = (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;
  const close = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
  if (open !== close || open !== collected.length) {
    console.error(
      `✗ <${tag}> 标签解析异常：开 ${open} / 闭 ${close} / 收集 ${collected.length}\n` +
      `  正文里可能存在裸的 </${tag}>，会截断解析。请先排查。`
    );
    process.exit(1);
  }
}

const sha = (s) => 'sha256-' + createHash('sha256').update(s, 'utf8').digest('base64');

const scripts = collect('script');
const styles = collect('style');
selfCheck('script', scripts);
selfCheck('style', styles);

if (!scripts.length && !styles.length) {
  console.error('✗ 没有找到任何内联 <script> / <style> 块');
  process.exit(1);
}

const scriptSrc = scripts.length
  ? scripts.map((s) => `'${sha(s.body)}'`).join(' ')
  : "'none'";
const styleSrc = styles.length
  ? styles.map((s) => `'${sha(s.body)}'`).join(' ')
  : "'none'";

const csp = [
  "default-src 'none'",
  `script-src ${scriptSrc}`,
  `style-src ${styleSrc}`,
  'img-src data: blob:',
  "font-src 'none'",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const META_RE = /<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*"\s*>/;
if (!META_RE.test(html)) {
  console.error('✗ 找不到 Content-Security-Policy 的 meta 标签');
  process.exit(1);
}

const next = html.replace(META_RE, `<meta http-equiv="Content-Security-Policy" content="${csp}">`);

if (next !== html) {
  writeFileSync(file, next, 'utf8');
  console.log(`✓ 已写回 ${file}`);
} else {
  console.log('• CSP 内容无变化');
}

console.log(`  内联 script 块：${scripts.length}`);
scripts.forEach((s, i) => console.log(`    [${i}] '${sha(s.body)}'`));
console.log(`  内联 style 块：${styles.length}`);
styles.forEach((s, i) => console.log(`    [${i}] '${sha(s.body)}'`));
console.log(`  字节数：${Buffer.byteLength(next, 'utf8')}`);
