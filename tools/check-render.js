// 渲染冒烟测试：把 site.js 的核心逻辑跑在 node 里，
// 验证 ① CHAPTERS 里的文件都存在 ② 高亮器不会崩、不会丢字符 ③ ghLink 生成正确
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = process.argv[2] || path.join(__dirname, '..');
const siteSrc = fs.readFileSync(path.join(ROOT, 'assets/js/site.js'), 'utf8');

// 提供最小的浏览器全局，让 site.js 能被求值（DOMContentLoaded 监听不会触发）
const sandbox = {
  document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
  window: { matchMedia: () => ({ matches: false }) },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: {}, location: { pathname: '/index.html' }, console,
  setTimeout, clearTimeout,
};
vm.createContext(sandbox);
try {
  // const/let 在 vm 里是词法声明，不会挂到 sandbox 上，末尾显式导出一下
  const EXPORT = ';globalThis.__x = { CHAPTERS, highlight, ghLink, SOURCE };';
  vm.runInContext(siteSrc + '\n' + EXPORT, sandbox, { filename: 'site.js' });
} catch (e) {
  console.log('✗ site.js 求值失败: ' + e.message);
  process.exit(1);
}

let bad = 0;

// ---- ① CHAPTERS 里的文件都存在，且顺序/编号连续 ----
const flat = sandbox.__x.CHAPTERS.flatMap(g => g.items);
flat.forEach((c, i) => {
  const p = path.join(ROOT, 'chapters', c.file);
  if (!fs.existsSync(p)) { bad++; console.log(`✗ 目录里的章节文件不存在: ${c.file}`); }
  if (c.id !== String(i).padStart(2, '0')) {
    bad++; console.log(`✗ 章节编号不连续: 第 ${i} 项的 id 是 ${c.id}`);
  }
});
// 反向：chapters/ 下的文件是否都在目录里
fs.readdirSync(path.join(ROOT, 'chapters')).filter(f => f.endsWith('.html')).forEach(f => {
  if (!flat.some(c => c.file === f)) { bad++; console.log(`✗ 文件未登记进 CHAPTERS: ${f}`); }
});
console.log(`目录: ${flat.length} 章，文件与编号${bad === 0 ? '一致 ✓' : '有问题'}`);

// ---- ② 高亮器跑遍所有代码块 ----
const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const stripTags = s => s.replace(/<[^>]+>/g, '');

let blocks = 0;
const pages = ['index.html', ...fs.readdirSync(path.join(ROOT, 'chapters'))
  .filter(f => f.endsWith('.html')).sort().map(f => 'chapters/' + f)];

for (const rel of pages) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const re = /<div class="codeblock"([^>]*)>\s*<pre><code>([\s\S]*?)<\/code><\/pre>/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    blocks++;
    const lang = (m[1].match(/data-lang="([^"]+)"/) || [, 'text'])[1];
    const raw = unesc(m[2]).replace(/^\n/, '').replace(/\s+$/, '');
    let outHtml;
    try {
      outHtml = raw.split('\n').map(l => sandbox.__x.highlight(l, lang)).join('\n');
    } catch (e) {
      bad++; console.log(`✗ 高亮崩溃 ${rel} (lang=${lang}): ${e.message}`);
      continue;
    }
    // 高亮后去掉标签、反转义，应该等于原文（不能丢字符）
    const back = unesc(stripTags(outHtml));
    if (back !== raw) {
      bad++;
      const i = [...raw].findIndex((ch, k) => ch !== back[k]);
      console.log(`✗ 高亮丢字符 ${rel} (lang=${lang}) 位置 ${i}`);
      console.log(`    原文: ${JSON.stringify(raw.slice(Math.max(0, i - 30), i + 40))}`);
      console.log(`    还原: ${JSON.stringify(back.slice(Math.max(0, i - 30), i + 40))}`);
    }
  }
}
console.log(`高亮: ${blocks} 个代码块${bad === 0 ? '全部无损 ✓' : ''}`);

// ---- ③ 永久链接格式 ----
const l1 = sandbox.__x.ghLink('pkg/device/devices.go', 34, 48);
const want = `https://github.com/${sandbox.__x.SOURCE.repo}/blob/${sandbox.__x.SOURCE.commit}/pkg/device/devices.go#L34-L48`;
if (l1 !== want) { bad++; console.log(`✗ ghLink 输出不对:\n    ${l1}\n    应为 ${want}`); }
else console.log(`永久链接: ${sandbox.__x.SOURCE.short} ✓`);

console.log('');
console.log(bad === 0 ? '✅ 渲染冒烟测试通过' : `❌ ${bad} 个问题`);
process.exit(bad === 0 ? 0 : 1);
