// 严格校验：每个 codeblock 的首行内容，是否真的等于源码 data-start 那一行
// （检查器 check.js 只验文件存在 + 行号不越界，这个验的是「内容对不对得上」）
const fs = require('fs'), path = require('path');

const ROOT = process.argv[2] || path.join(__dirname, '..');
const REPO = path.resolve(ROOT, '..');
const files = fs.readdirSync(path.join(ROOT, 'chapters'))
  .filter(f => f.endsWith('.html')).sort().map(f => 'chapters/' + f);

const unesc = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// 去掉教程里追加的中文行尾注释，只比对代码本体
const strip = s => s
  .replace(/\/\/[^\n]*[一-龥][^\n]*$/, '')   // 行尾中文注释
  .replace(/\s+/g, ' ').trim();

let bad = 0, checked = 0, warn = 0;
const report = [];

for (const rel of files) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const re = /<div class="codeblock"([^>]*)>\s*<pre><code>([\s\S]*?)<\/code><\/pre>/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const attrs = m[1];
    const fm = attrs.match(/data-file="([^"]+)"/);
    const sm = attrs.match(/data-start="(\d+)"/);
    if (!fm || !sm) continue;

    const file = fm[1], start = +sm[1];
    const p = path.join(REPO, file);
    if (!fs.existsSync(p)) { bad++; report.push(`  ✗ ${rel}: 文件不存在 ${file}`); continue; }

    const srcLines = fs.readFileSync(p, 'utf8').split('\n');
    const snippet = unesc(m[2]).replace(/^\n/, '').split('\n');

    // 找出片段里第一行非空、非纯注释的代码行，以及它在片段里的偏移
    let off = 0;
    while (off < snippet.length && snippet[off].trim() === '') off++;
    if (off >= snippet.length) continue;

    checked++;
    const want = strip(snippet[off]);
    const got = strip(srcLines[start + off - 1] || '');

    if (want === got) continue;

    // 容错：在 ±3 行内找找看，可能是我数错了几行
    let found = -1;
    for (let d = -3; d <= 3; d++) {
      if (d === 0) continue;
      if (strip(srcLines[start + off - 1 + d] || '') === want) { found = d; break; }
    }
    if (found !== -1) {
      bad++;
      report.push(`  ✗ ${rel}\n      ${file}:${start}  行号偏了 ${found > 0 ? '+' : ''}${found} 行`
        + `\n      教程写的: ${want.slice(0, 78)}`
        + `\n      该行实际: ${got.slice(0, 78)}`);
    } else {
      // 找不到 → 可能是教程做了删减/改写，只警告
      warn++;
      report.push(`  ⚠ ${rel}\n      ${file}:${start}  首行对不上（可能是教程做了删减，请人工确认）`
        + `\n      教程写的: ${want.slice(0, 78)}`
        + `\n      该行实际: ${got.slice(0, 78)}`);
    }
  }
}

console.log(`比对了 ${checked} 个带行号的代码块\n`);
if (report.length) console.log(report.join('\n') + '\n');
console.log(bad === 0
  ? `✅ 无行号偏移${warn ? `（${warn} 处需人工确认）` : ''}`
  : `❌ ${bad} 处行号偏移需要修正${warn ? `，另有 ${warn} 处需人工确认` : ''}`);
process.exit(bad === 0 ? 0 : 1);
