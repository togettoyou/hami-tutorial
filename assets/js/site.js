/* ============================================================
 *  HAMi 源码导读 — 站点引擎（零依赖）
 *  功能：侧边栏 / 进度追踪 / 代码高亮 / 行号 / GitHub 永久链接
 *        / 复制 / 自测 / 主题切换
 * ============================================================ */

/* ------------------------------------------------------------
 *  1. 全局配置
 *
 *  SOURCE.commit 是写作时对照的 commit，所有 GitHub 链接都基于它生成，
 *  上游后续改动不会让行号跳错。改这里就能整站换版本，
 *  换版本后行号会漂移，需要重新校对。
 * ---------------------------------------------------------- */
const SOURCE = {
  repo:    'togettoyou/HAMi',
  commit:  '95530c6ad09c4f3cf8651cfe53a89eda69238a85',
  short:   '95530c6',
  version: 'v2.10.0',
  date:    '2026-09-02',
  upstream:'Project-HAMi/HAMi',
};

/** 生成指向固定 commit 的 GitHub 永久链接 */
function ghLink(file, startLine, endLine) {
  let url = `https://github.com/${SOURCE.repo}/blob/${SOURCE.commit}/${file}`;
  if (startLine) {
    url += `#L${startLine}`;
    if (endLine && endLine !== startLine) url += `-L${endLine}`;
  }
  return url;
}

/* ------------------------------------------------------------
 *  2. 章节目录
 * ---------------------------------------------------------- */
const CHAPTERS = [
  { stage: '打地基', items: [
    { id: '00', file: '00-start.html',        title: '环境、全景与读码方法',
      desc: '把仓库跑起来，用单元测试当调试器', time: '1.5 h' },
    { id: '01', file: '01-protocol.html',     title: '注解协议',
      desc: '三个进程之间传的那串字符串', time: '2 h' },
    { id: '02', file: '02-devices.html',      title: 'Devices 接口与数据结构',
      desc: '15 个方法，12 家硬件共用的契约', time: '3 h' },
  ]},
  { stage: '一个 Pod 的旅程', items: [
    { id: '03', file: '03-webhook.html',      title: 'Webhook 准入',
      desc: '改 schedulerName、补默认值、拦非法请求', time: '1.5 h' },
    { id: '04', file: '04-filter.html',       title: 'Filter 主流程',
      desc: '取用量、打分、选节点、写注解', time: '3 h' },
    { id: '05', file: '05-score-fit.html',    title: '打分与 Fit',
      desc: '两层打分加逐卡筛选，binpack 与 spread 的实现', time: '4 h' },
    { id: '06', file: '06-bind.html',         title: 'Bind 与失败回滚',
      desc: '节点锁怎么防并发超卖', time: '2 h' },
  ]},
  { stage: '硬骨头', items: [
    { id: '07', file: '07-concurrency.html',  title: '并发与一致性',
      desc: 'informer 回调、缓存、选主', time: '3 h' },
    { id: '08', file: '08-device-plugin.html',title: 'Device Plugin',
      desc: '上报虚拟卡，把注解翻译成环境变量', time: '3 h' },
    { id: '09', file: '09-hami-core.html',    title: 'HAMi-core CUDA 劫持',
      desc: 'dlsym 劫持、显存 OOM、算力令牌桶', time: '2.5 h' },
    { id: '10', file: '10-nvidia-adv.html',   title: 'MIG、NVLink、NUMA 回填',
      desc: '三块技术密度最高的实现', time: '3 h' },
  ]},
  { stage: '参与贡献', items: [
    { id: '11', file: '11-contribute.html',   title: '测试、CI 与第一个 PR',
      desc: '本地跑通全部检查，找到能做的活', time: '2 h' },
    { id: '12', file: '12-cheatsheet.html',   title: '速查手册',
      desc: '注解、命令、文件索引，带全局搜索', time: '常翻' },
  ]},
];

const FLAT = CHAPTERS.flatMap(g => g.items);

/* ------------------------------------------------------------
 *  3. 进度存储
 * ---------------------------------------------------------- */
const Store = {
  KEY: 'hami-tutorial-progress-v1',
  read() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '{}'); }
    catch (e) { return {}; }
  },
  write(o) {
    try { localStorage.setItem(this.KEY, JSON.stringify(o)); } catch (e) {}
  },
  /** 某章的目标勾选状态 */
  goals(ch) { return this.read()['goals_' + ch] || {}; },
  setGoal(ch, idx, val) {
    const all = this.read();
    const g = all['goals_' + ch] || {};
    g[idx] = val;
    all['goals_' + ch] = g;
    this.write(all);
  },
  /** 一章是否完成 = 该章所有目标都勾了 */
  isDone(ch, total) {
    const g = this.goals(ch);
    if (!total) return false;
    let n = 0;
    for (const k in g) if (g[k]) n++;
    return n >= total;
  },
  totals() { return this.read()['_totals'] || {}; },
  setTotal(ch, total) {
    const all = this.read();
    all['_totals'] = all['_totals'] || {};
    all['_totals'][ch] = total;
    this.write(all);
  },
  reset() { try { localStorage.removeItem(this.KEY); } catch (e) {} },
};

/* ------------------------------------------------------------
 *  4. 代码高亮（手写轻量分词器，无外部依赖）
 * ---------------------------------------------------------- */
const RULES = {
  go: [
    ['comment', String.raw`//[^\n]*|/\*[\s\S]*?\*/`],
    ['string',  '`[^`]*`|"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\''],
    ['keyword', String.raw`\b(?:func|type|struct|interface|map|chan|go|defer|return|if|else|for|range|switch|case|default|break|continue|var|const|package|import|select|fallthrough|goto|nil|true|false)\b`],
    ['type',    String.raw`\b(?:string|int|int8|int16|int32|int64|uint|uint8|uint32|uint64|float32|float64|bool|byte|rune|error|any|make|append|len|cap|new|copy|delete|panic|recover)\b`],
    ['number',  String.raw`\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?\b`],
    ['fn',      String.raw`\b[A-Za-z_]\w*(?=\()`],
  ],
  c: [
    ['comment', String.raw`//[^\n]*|/\*[\s\S]*?\*/`],
    ['string',  '"(?:\\\\.|[^"\\\\\\n])*"'],
    ['keyword', String.raw`^\s*#\s*\w+|\b(?:int|void|char|static|const|struct|typedef|return|if|else|for|while|size_t|unsigned|long|extern|volatile|sizeof)\b`],
    ['type',    String.raw`\b(?:CUresult|CUdeviceptr|nvmlReturn_t|int64_t|uint64_t|pthread_t)\b`],
    ['number',  String.raw`\b0[xX][0-9a-fA-F]+\b|\b\d+\b`],
    ['fn',      String.raw`\b[A-Za-z_]\w*(?=\()`],
  ],
  yaml: [
    ['comment', '#[^\\n]*'],
    ['attr',    String.raw`^\s*-?\s*[\w.\-/"]+(?=\s*:)`],
    ['string',  '"[^"\\n]*"|\'[^\'\\n]*\''],
    ['number',  String.raw`\b\d+\b`],
  ],
  bash: [
    ['comment', '#[^\\n]*'],
    ['string',  '"(?:\\\\.|[^"\\\\])*"|\'[^\']*\''],
    ['keyword', String.raw`^\s*(?:go|make|kubectl|helm|git|docker|cd|cat|grep|sed|awk|curl|python3?)\b`],
    ['fn',      String.raw`\s-{1,2}[\w-]+`],
  ],
  text: [],
  json: [
    ['attr',   '"[^"\\n]*"(?=\\s*:)'],
    ['string', '"(?:\\\\.|[^"\\\\\\n])*"'],
    ['number', String.raw`\b-?\d+(?:\.\d+)?\b`],
    ['keyword', String.raw`\b(?:true|false|null)\b`],
  ],
};

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlight(code, lang) {
  const rules = RULES[lang] || RULES.text;
  if (!rules.length) return esc(code);
  const re = new RegExp(rules.map(r => '(' + r[1] + ')').join('|'), 'g');
  let out = '', last = 0, m;
  while ((m = re.exec(code)) !== null) {
    if (m.index > last) out += esc(code.slice(last, m.index));
    let kind = 'text';
    for (let i = 1; i < m.length; i++) {
      if (m[i] !== undefined) { kind = rules[i - 1][0]; break; }
    }
    out += `<span class="tok-${kind}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;   // 保险，防止空匹配死循环
  }
  out += esc(code.slice(last));
  return out;
}

/**
 * 把 <div class="codeblock"> 渲染成带行号 / 头部 / 复制 / GitHub 链接的代码块。
 * 支持属性：
 *   data-file   源码相对路径（有则显示路径 + GitHub 永久链接）
 *   data-start  起始行号（有则显示真实行号）
 *   data-lang   go | c | yaml | bash | json | text
 *   data-hl     需要高亮的相对行号，从 1 开始，逗号分隔，支持 3-6 区间
 *   data-title  自定义标题（无 data-file 时用）
 */
function renderCodeBlocks(root) {
  root.querySelectorAll('.codeblock').forEach(block => {
    if (block.dataset.rendered) return;
    block.dataset.rendered = '1';

    const codeEl = block.querySelector('code');
    if (!codeEl) return;

    let raw = codeEl.textContent.replace(/^\n/, '').replace(/\s+$/, '');

    // 行号是一个定宽 inline-block，会把 <pre> 的制表位算歪，
    // 所以显示时把 Tab 展开成空格；复制出去的仍是原始的 Tab。
    const shown = raw.replace(/\t/g, '    ');

    const lang  = block.dataset.lang || 'text';
    const start = parseInt(block.dataset.start || '0', 10);
    const file  = block.dataset.file || '';

    // 解析需要高亮的行
    const hlSet = new Set();
    (block.dataset.hl || '').split(',').forEach(part => {
      part = part.trim();
      if (!part) return;
      if (part.includes('-')) {
        const [a, b] = part.split('-').map(Number);
        for (let i = a; i <= b; i++) hlSet.add(i);
      } else hlSet.add(Number(part));
    });

    const lines = shown.split('\n');
    const html = lines.map((line, i) => {
      const rel = i + 1;
      const abs = start ? start + i : null;
      const ln  = start ? `<span class="ln">${abs}</span>` : '';
      const cls = hlSet.has(rel) ? 'row hl' : 'row';
      return `<span class="${cls}">${ln}${highlight(line, lang) || '&nbsp;'}</span>`;
    }).join('');   // .row 是 display:block，不能再用 \n 连接：
                   // <pre> 会把那个换行符当成实打实的空白，多撑出一整行

    codeEl.innerHTML = html;

    // 头部
    const header = document.createElement('header');
    let left = '';
    if (file) {
      const endLine = start ? start + lines.length - 1 : null;
      const range = start ? `:${start}-${endLine}` : '';
      left = `<span class="path"><b>${esc(file.split('/').pop())}</b> &nbsp;${esc(file)}${range}</span>`;
    } else {
      left = `<span class="path">${esc(block.dataset.title || (lang === 'bash' ? '终端' : lang))}</span>`;
    }
    header.innerHTML = left + '<span class="spacer"></span>';

    if (file) {
      const a = document.createElement('a');
      a.className = 'gh';
      a.href = ghLink(file, start || null, start ? start + lines.length - 1 : null);
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'GitHub ↗';
      a.title = `在 GitHub 打开（${SOURCE.short}）`;
      header.appendChild(a);
    }

    const btn = document.createElement('button');
    btn.textContent = '复制';
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(raw).then(
        () => { btn.textContent = '已复制'; toast('已复制到剪贴板'); setTimeout(() => btn.textContent = '复制', 1400); },
        () => toast('复制失败，请手动选中')
      );
    });
    header.appendChild(btn);

    block.insertBefore(header, block.firstChild);
  });
}

/* ------------------------------------------------------------
 *  5. 行内源码引用 <span class="src" data-file="..." data-line="...">
 * ---------------------------------------------------------- */
function renderSrcRefs(root) {
  root.querySelectorAll('[data-srcref]').forEach(el => {
    const ref = el.dataset.srcref;             // 形如 pkg/x/y.go:123 或 pkg/x/y.go:12-40
    const m = ref.match(/^(.+?):(\d+)(?:-(\d+))?$/);
    const file = m ? m[1] : ref;
    const s = m ? m[2] : null;
    const e = m ? m[3] : null;
    const a = document.createElement('a');
    a.href = ghLink(file, s, e);
    a.target = '_blank';
    a.rel = 'noopener';
    a.innerHTML = `<code>${esc(ref)}</code>`;
    a.title = `GitHub 永久链接 @ ${SOURCE.short}`;
    el.replaceWith(a);
  });
}

/* ------------------------------------------------------------
 *  6. 自测
 * ---------------------------------------------------------- */
function renderQuizzes(root) {
  root.querySelectorAll(".quiz").forEach((quiz, qi) => {
    const answer = (quiz.dataset.answer || "").toUpperCase();
    const expl = quiz.querySelector(".expl");
    const opts = quiz.querySelectorAll(".opt");
    const qn = quiz.querySelector(".q");
    if (qn && !qn.querySelector(".qn")) {
      const s = document.createElement("span");
      s.className = "qn";
      s.textContent = "Q" + (qi + 1);
      qn.insertBefore(s, qn.firstChild);
    }
    opts.forEach(opt => {
      opt.addEventListener("click", () => {
        const key = (opt.dataset.k || "").toUpperCase();
        opts.forEach(o => o.classList.remove("correct", "wrong"));
        if (key === answer) {
          opt.classList.add("correct");
        } else {
          opt.classList.add("wrong");
          opts.forEach(o => { if ((o.dataset.k || "").toUpperCase() === answer) o.classList.add("correct"); });
        }
        if (expl) expl.classList.add("show");
      });
    });
  });
}

/* ------------------------------------------------------------
 *  7. 侧边栏 + 进度
 * ---------------------------------------------------------- */
function currentChapterId() {
  const f = location.pathname.split('/').pop() || 'index.html';
  const hit = FLAT.find(c => c.file === f);
  return hit ? hit.id : null;
}

function buildSidebar() {
  const host = document.getElementById('sidebar');
  if (!host) return;
  const cur = currentChapterId();
  const isIndex = !cur;
  const prefix = isIndex ? 'chapters/' : '';
  const home = isIndex ? 'index.html' : '../index.html';
  const totals = Store.totals();

  let html = `
    <div class="brand">
      <a href="${home}">
        <h1>HAMi 源码导读</h1>
        <div class="sub">${SOURCE.version} @ ${SOURCE.short}</div>
      </a>
    </div>
    <div class="progress-wrap">
      <div class="progress-bar"><i id="pbar"></i></div>
      <div class="progress-text" id="ptext">0 / ${FLAT.length} 章完成</div>
    </div>
    <ul class="nav">`;

  CHAPTERS.forEach(g => {
    html += `<li class="group">${g.stage}</li>`;
    g.items.forEach(c => {
      const done = Store.isDone(c.id, totals[c.id]);
      html += `<li><a href="${prefix}${c.file}" class="${c.id === cur ? 'active' : ''}">
        <span class="num">${c.id}</span>
        <span class="t">${c.title}</span>
        ${done ? '<span class="done-dot">✓</span>' : ''}
      </a></li>`;
    });
  });

  html += `</ul>
    <div class="side-foot">
      <button id="themeBtn">◐ 切换主题</button>
      <a href="https://github.com/${SOURCE.repo}/tree/${SOURCE.commit}" target="_blank" rel="noopener">↗ 对照的源码 commit</a>
      <a href="https://github.com/${SOURCE.upstream}" target="_blank" rel="noopener">↗ HAMi 上游仓库</a>
      <button id="resetBtn">↺ 清空学习进度</button>
    </div>`;

  host.innerHTML = html;

  document.getElementById('themeBtn').addEventListener('click', toggleTheme);
  document.getElementById('resetBtn').addEventListener('click', () => {
    if (confirm('确定清空所有章节的学习进度吗？')) { Store.reset(); location.reload(); }
  });

  updateProgress();
}

function updateProgress() {
  const totals = Store.totals();
  const done = FLAT.filter(c => Store.isDone(c.id, totals[c.id])).length;
  const bar = document.getElementById('pbar');
  const txt = document.getElementById('ptext');
  if (bar) bar.style.width = (done / FLAT.length * 100) + '%';
  if (txt) txt.textContent = `${done} / ${FLAT.length} 章完成`;
  // 侧边栏勾
  document.querySelectorAll('.nav a').forEach(a => {
    const num = a.querySelector('.num');
    if (!num) return;
    const id = num.textContent.trim();
    const isDone = Store.isDone(id, totals[id]);
    let dot = a.querySelector('.done-dot');
    if (isDone && !dot) {
      dot = document.createElement('span');
      dot.className = 'done-dot';
      dot.textContent = '✓';
      a.appendChild(dot);
    } else if (!isDone && dot) dot.remove();
  });
  // 首页卡片
  document.querySelectorAll('.rm-card[data-ch]').forEach(card => {
    const id = card.dataset.ch;
    card.classList.toggle('done', Store.isDone(id, totals[id]));
  });
}

/* ------------------------------------------------------------
 *  8. 学习目标 checklist
 * ---------------------------------------------------------- */
function bindGoals() {
  const box = document.querySelector('.goals');
  if (!box) return;
  const ch = currentChapterId();
  if (!ch) return;
  const items = box.querySelectorAll('li');
  Store.setTotal(ch, items.length);
  const saved = Store.goals(ch);

  items.forEach((li, i) => {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = `goal-${ch}-${i}`;
    cb.checked = !!saved[i];
    const label = document.createElement('label');
    label.setAttribute('for', cb.id);
    label.innerHTML = li.innerHTML;
    li.innerHTML = '';
    li.appendChild(cb);
    li.appendChild(label);
    cb.addEventListener('change', () => {
      Store.setGoal(ch, i, cb.checked);
      updateProgress();
      const totals = Store.totals();
      if (Store.isDone(ch, totals[ch])) toast('本章完成 ✓ 进度已保存');
    });
  });
  updateProgress();
}

/* ------------------------------------------------------------
 *  9. 上下章导航
 * ---------------------------------------------------------- */
function buildChapterNav() {
  const host = document.getElementById('chapterNav');
  if (!host) return;
  const cur = currentChapterId();
  const i = FLAT.findIndex(c => c.id === cur);
  if (i < 0) return;
  const prev = FLAT[i - 1], next = FLAT[i + 1];
  let html = '';
  if (prev) html += `<a href="${prev.file}"><div class="dir">← 上一章 · ${prev.id}</div><div class="ttl">${prev.title}</div></a>`;
  else html += `<a href="../index.html"><div class="dir">← 返回</div><div class="ttl">教程首页</div></a>`;
  if (next) html += `<a class="next" href="${next.file}"><div class="dir">下一章 · ${next.id} →</div><div class="ttl">${next.title}</div></a>`;
  else html += `<a class="next" href="../index.html"><div class="dir">全部学完 🎉</div><div class="ttl">回到首页看看进度</div></a>`;
  host.innerHTML = html;
}

/* ------------------------------------------------------------
 * 10. 主题 / toast / 移动端菜单
 * ---------------------------------------------------------- */
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const next = cur ? (cur === 'dark' ? 'light' : 'dark') : (sysDark ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('hami-theme', next); } catch (e) {}
}

(function initTheme() {
  try {
    const t = localStorage.getItem('hami-theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();

let toastTimer = null;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function buildMenuBtn() {
  const btn = document.createElement('button');
  btn.className = 'menu-btn';
  btn.innerHTML = '☰';
  btn.setAttribute('aria-label', '目录');
  btn.addEventListener('click', () => {
    document.querySelector('.sidebar').classList.toggle('open');
  });
  document.body.appendChild(btn);
}

/* ------------------------------------------------------------
 * 11. 启动
 * ---------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  buildSidebar();
  buildMenuBtn();
  bindGoals();
  renderCodeBlocks(document);
  renderSrcRefs(document);
  renderQuizzes(document);
  buildChapterNav();

  // 键盘：← → 翻章
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    const cur = currentChapterId();
    const i = FLAT.findIndex(c => c.id === cur);
    if (i < 0) return;
    if (e.key === 'ArrowRight' && FLAT[i + 1]) location.href = FLAT[i + 1].file;
    if (e.key === 'ArrowLeft' && FLAT[i - 1]) location.href = FLAT[i - 1].file;
  });
});
