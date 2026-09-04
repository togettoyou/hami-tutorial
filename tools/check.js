// 教程站点校验：内联 JS 语法 + 标签配平 + 死链 + data-srcref 格式
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = process.argv[2] || path.join(__dirname, '..');
const files = [];
if (fs.existsSync(path.join(ROOT, 'index.html'))) files.push('index.html');
const chDir = path.join(ROOT, 'chapters');
if (fs.existsSync(chDir)) {
  fs.readdirSync(chDir).filter(f => f.endsWith('.html')).sort()
    .forEach(f => files.push('chapters/' + f));
}

// 需要严格配平的容器标签（li/p/td/th/tr 允许省略闭合，跳过）
const PAIRED = ['div', 'table', 'ul', 'ol', 'pre', 'code', 'details', 'summary', 'main', 'nav', 'span', 'button', 'select', 'textarea', 'label'];

let problems = 0;
const report = [];

for (const rel of files) {
  const full = path.join(ROOT, rel);
  const src = fs.readFileSync(full, 'utf8');

  // --- 1. 内联 <script> 语法检查 ---
  const scriptRe = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = scriptRe.exec(src)) !== null) {
    n++;
    try { new vm.Script(m[1], { filename: rel + '#inline' + n }); }
    catch (e) { problems++; report.push(`  ✗ JS 语法错误 ${rel} 第 ${n} 段: ${e.message}`); }
  }

  // --- 2. 标签配平（排除 <script> 和 <pre> 内的内容） ---
  const stripped = src
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<pre[\s\S]*?<\/pre>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of PAIRED) {
    const open = (stripped.match(new RegExp('<' + tag + '(?=[\\s>])', 'g')) || []).length;
    const close = (stripped.match(new RegExp('</' + tag + '>', 'g')) || []).length;
    if (open !== close) {
      problems++;
      report.push(`  ✗ 标签不配平 ${rel}: <${tag}> 开 ${open} / 闭 ${close}`);
    }
  }

  // --- 3. 站内链接是否存在 ---
  const hrefRe = /href="([^"#:]+\.html)"/g;
  while ((m = hrefRe.exec(src)) !== null) {
    const target = path.resolve(path.dirname(full), m[1]);
    if (!fs.existsSync(target)) {
      problems++;
      report.push(`  ✗ 死链 ${rel} → ${m[1]}`);
    }
  }

  // --- 4. data-srcref 必须能对应到真实源码文件 ---
  const refRe = /data-srcref="([^"]+)"/g;
  const repoRoot = path.resolve(ROOT, '..');
  while ((m = refRe.exec(src)) !== null) {
    const ref = m[1];
    const mm = ref.match(/^(.+?)(?::(\d+)(?:-(\d+))?)?$/);
    const file = mm[1];
    if (!fs.existsSync(path.join(repoRoot, file))) {
      problems++;
      report.push(`  ✗ data-srcref 指向不存在的文件 ${rel}: ${file}`);
    } else if (mm[2]) {
      const lines = fs.readFileSync(path.join(repoRoot, file), 'utf8').split('\n').length;
      if (+mm[2] > lines) {
        problems++;
        report.push(`  ✗ data-srcref 行号越界 ${rel}: ${ref}（文件只有 ${lines} 行）`);
      }
    }
  }

  // --- 5. codeblock 的 data-file 也要存在，且行号+行数不越界 ---
  const cbRe = /<div class="codeblock"([^>]*)>\s*<pre><code>([\s\S]*?)<\/code><\/pre>/g;
  while ((m = cbRe.exec(src)) !== null) {
    const attrs = m[1];
    const fm = attrs.match(/data-file="([^"]+)"/);
    const sm = attrs.match(/data-start="(\d+)"/);
    if (!fm) continue;
    const file = fm[1];
    const p = path.join(repoRoot, file);
    if (!fs.existsSync(p)) {
      problems++;
      report.push(`  ✗ codeblock data-file 不存在 ${rel}: ${file}`);
      continue;
    }
    if (sm) {
      const total = fs.readFileSync(p, 'utf8').split('\n').length;
      const start = +sm[1];
      const snippetLines = m[2].replace(/^\n/, '').replace(/\s+$/, '').split('\n').length;
      if (start > total) {
        problems++;
        report.push(`  ✗ codeblock 起始行越界 ${rel}: ${file}:${start}（共 ${total} 行）`);
      } else if (start + snippetLines - 1 > total + 5) {
        problems++;
        report.push(`  ✗ codeblock 行范围越界 ${rel}: ${file}:${start}+${snippetLines}（共 ${total} 行）`);
      }
    }
  }

  const cb = (src.match(/class="codeblock"/g) || []).length;
  const qz = (src.match(/class="quiz"/g) || []).length;
  const lab = (src.match(/class="lab"/g) || []).length;
  const goals = (src.match(/<li>/g) || []).length;
  console.log(`${rel.padEnd(30)} 代码块 ${String(cb).padStart(2)} · 测验 ${qz} · 实验室 ${lab} · 内联脚本 ${n}`);
}

console.log('');
if (report.length) { console.log(report.join('\n')); }
console.log(problems === 0 ? '\n✅ 全部检查通过' : `\n❌ 共 ${problems} 个问题`);
process.exit(problems === 0 ? 0 : 1);
