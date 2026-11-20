#!/usr/bin/env node
/**
 * npm run measure が書き出した measure-result-<戦略>.json を読んで、
 * 周回カーブのグラフページ（単一HTML）を生成する。
 *
 * 使い方:
 *   node scripts/make-curve-chart.mjs cap growth
 *   → curve-chart.html
 *
 * データはHTMLに埋め込むので、出力ファイル単体で開ける。
 */

import { readFileSync, writeFileSync } from 'node:fs';

const strategies = process.argv.slice(2);
if (strategies.length === 0) {
  console.error('使い方: node scripts/make-curve-chart.mjs <戦略名> [<戦略名> ...]');
  process.exit(1);
}

const STRATEGY_LABEL = {
  cap: '能力上限を先に買う',
  growth: '成長率を先に買う',
  harvest: '結晶の獲得量を先に買う'
};

const datasets = strategies.map((name) => {
  const raw = JSON.parse(readFileSync(`measure-result-${name}.json`, 'utf8'));
  return {
    name,
    label: STRATEGY_LABEL[name] || name,
    generations: raw.generations,
    totalMonths: raw.totalMonths,
    ascensionEvents: raw.ascensionEvents || [],
    points: raw.rows.map((r) => ({
      gen: r['周回'],
      peak: r['ピーク'],
      stage: r['転生段階'],
      reached: r['到達'],
      target: r['目標'],
      verdict: r['判定'],
      retireAge: r['引退'],
      legLv: r['強化計Lv'],
      holy: r['聖杯'],
      months: r['月数']
    }))
  };
});

const payload = JSON.stringify({ datasets }, null, 1);

const html = `<meta name="claude:viewport-fit-sides" content="cover">
<title>Football Chronicle 成長曲線</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;700&display=swap">
<style>
  /* レイアウト: 1カラム。グラフを主役に置き、下に根拠の表を続ける */
  :root {
    --bg: #fbfbfa;
    --surface: #ffffff;
    --ink: #1a1a19;
    --ink-soft: #55554f;
    --ink-faint: #8a8a81;
    --rule: #e3e3dd;
    --grid: #ededE6;
    --s1: #2563eb;
    --s2: #ea580c;
    --s3: #059669;
    --warn: #b45309;
    --font-display: 'Space Grotesk', 'Hiragino Sans', 'Yu Gothic', system-ui, sans-serif;
    --font-body: 'Inter', 'Hiragino Sans', 'Yu Gothic', system-ui, sans-serif;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #141413;
      --surface: #1f1f1d;
      --ink: #f2f2ee;
      --ink-soft: #b4b4ab;
      --ink-faint: #7d7d74;
      --rule: #32322e;
      --grid: #2a2a27;
      --s1: #4f8df5;
      --s2: #e06c1c;
      --s3: #1fae7a;
      --warn: #d8963a;
      color-scheme: dark;
    }
  }
  :root[data-theme="dark"] {
    --bg: #141413;
    --surface: #1f1f1d;
    --ink: #f2f2ee;
    --ink-soft: #b4b4ab;
    --ink-faint: #7d7d74;
    --rule: #32322e;
    --grid: #2a2a27;
    --s1: #4f8df5;
    --s2: #e06c1c;
    --s3: #1fae7a;
    --warn: #d8963a;
    color-scheme: dark;
  }

  body {
    background: var(--bg);
    color: var(--ink);
    font-family: var(--font-body);
    line-height: 1.6;
  }
  .wrap {
    max-width: 960px;
    margin: 0 auto;
    padding-left: max(16px, env(safe-area-inset-left, 0px));
    padding-right: max(16px, env(safe-area-inset-right, 0px));
    padding-block: 32px 56px;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }
  header h1 {
    font-family: var(--font-display);
    font-size: clamp(1.5rem, 4vw, 2rem);
    font-weight: 700;
    letter-spacing: -0.01em;
    margin: 0 0 6px;
    text-wrap: balance;
  }
  header p {
    margin: 0;
    color: var(--ink-soft);
    max-width: 62ch;
  }
  .eyebrow {
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-faint);
    font-weight: 600;
    margin: 0 0 4px;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 10px;
    padding: 18px 16px 14px;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    align-items: center;
    margin-bottom: 10px;
    font-size: 0.82rem;
  }
  .legend span { display: inline-flex; align-items: center; gap: 7px; color: var(--ink-soft); }
  .swatch { width: 18px; height: 3px; border-radius: 2px; flex: none; }
  .swatch.dot { width: 10px; height: 10px; border-radius: 50%; }

  .chart-box { position: relative; }
  svg { display: block; width: 100%; height: auto; max-width: 100%; overflow: visible; }

  .tip {
    position: absolute;
    pointer-events: none;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 8px;
    padding: 9px 11px;
    font-size: 0.78rem;
    line-height: 1.5;
    box-shadow: 0 6px 20px rgb(0 0 0 / 0.14);
    min-width: 170px;
    z-index: 5;
  }
  .tip[hidden] { display: none !important; }
  .tip b { font-family: var(--font-display); font-size: 0.86rem; }
  .tip dl { display: grid; grid-template-columns: auto 1fr; gap: 1px 10px; margin: 6px 0 0; }
  .tip dt { color: var(--ink-faint); }
  .tip dd { margin: 0; font-variant-numeric: tabular-nums; }

  h2 {
    font-family: var(--font-display);
    font-size: 1.05rem;
    font-weight: 700;
    margin: 0 0 10px;
  }
  .notes { margin: 0; padding-left: 1.1em; color: var(--ink-soft); font-size: 0.86rem; }
  .notes li { margin-bottom: 4px; }

  .table-scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 0.8rem; min-width: 560px; }
  th, td { padding: 6px 9px; text-align: right; border-bottom: 1px solid var(--rule); font-variant-numeric: tabular-nums; }
  th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align: left; }
  thead th { color: var(--ink-faint); font-weight: 600; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; }
  tbody tr.ascend td { color: var(--warn); font-weight: 600; }

  .foot { color: var(--ink-faint); font-size: 0.78rem; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>

<div class="wrap">
  <header>
    <p class="eyebrow">npm run measure の実測結果</p>
    <h1>周回を重ねると、どこまで強くなるか</h1>
    <p>5歳から選手を育て、引退したら記憶だけ持って5歳へ戻る。その周回を20回ぶん自動でプレイした記録。縦軸はそのキャリアで到達した総合力の最高値で、対数目盛。横線は各リーグに上がるのに必要な総合力。</p>
  </header>

  <section class="card">
    <div class="legend" id="legend"></div>
    <div class="chart-box">
      <svg id="chart" viewBox="0 0 860 430" role="img" aria-labelledby="chart-title"></svg>
      <div class="tip" id="tip" hidden></div>
    </div>
  </section>

  <section class="card">
    <h2>読み取れること</h2>
    <ul class="notes" id="findings"></ul>
  </section>

  <section class="card">
    <h2>数値</h2>
    <div class="table-scroll"><table id="table"></table></div>
  </section>

  <p class="foot" id="foot"></p>
</div>

<script id="data" type="application/json">${payload}</script>
<script>
(function () {
  var DATA = JSON.parse(document.getElementById('data').textContent);
  var sets = DATA.datasets;
  var SERIES_COLORS = ['--s1', '--s2', '--s3'];

  // リーグ昇格に必要な総合力（App.jsx の CATEGORIES.reqRating）
  var TIERS = [
    { v: 82, name: '社会人' },
    { v: 125, name: 'JFL' },
    { v: 195, name: 'J3' },
    { v: 310, name: 'J2' },
    { v: 500, name: 'J1' },
    { v: 850, name: '欧州中堅' },
    { v: 1500, name: '欧州CC' },
    { v: 2800, name: 'W杯代表' }
  ];

  var W = 860, H = 430;
  var M = { t: 16, r: 92, b: 38, l: 50 };
  var iw = W - M.l - M.r, ih = H - M.t - M.b;

  var maxGen = 0, maxPeak = 0;
  sets.forEach(function (s) {
    s.points.forEach(function (p) {
      if (p.gen > maxGen) maxGen = p.gen;
      if (p.peak > maxPeak) maxPeak = p.peak;
    });
  });
  var yTop = Math.max(maxPeak, 1500) * 1.35;
  var yBottom = 8;

  function x(gen) { return M.l + ((gen - 1) / Math.max(1, maxGen - 1)) * iw; }
  function y(v) {
    var val = Math.max(v, yBottom);
    var lo = Math.log(yBottom), hi = Math.log(yTop);
    return M.t + ih - ((Math.log(val) - lo) / (hi - lo)) * ih;
  }

  var ns = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, text) {
    var n = document.createElementNS(ns, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }

  var svg = document.getElementById('chart');
  svg.appendChild(el('title', { id: 'chart-title' }, '周回ごとの到達総合力'));

  // --- リーグの境界線 ---
  TIERS.forEach(function (t) {
    if (t.v > yTop) return;
    var yy = y(t.v);
    svg.appendChild(el('line', {
      x1: M.l, x2: M.l + iw, y1: yy, y2: yy,
      stroke: 'var(--grid)', 'stroke-width': 1, 'stroke-dasharray': '3 4'
    }));
    svg.appendChild(el('text', {
      x: M.l + iw + 8, y: yy + 4, fill: 'var(--ink-faint)', 'font-size': 11
    }, t.name + ' ' + t.v));
  });

  // --- 軸 ---
  svg.appendChild(el('line', { x1: M.l, x2: M.l + iw, y1: M.t + ih, y2: M.t + ih, stroke: 'var(--rule)', 'stroke-width': 1 }));
  for (var g = 1; g <= maxGen; g++) {
    if (g !== 1 && g % 5 !== 0 && g !== maxGen) continue;
    svg.appendChild(el('text', {
      x: x(g), y: M.t + ih + 20, fill: 'var(--ink-faint)', 'font-size': 11, 'text-anchor': 'middle'
    }, g + '周'));
  }

  // --- 系列 ---
  var hitData = [];
  sets.forEach(function (s, si) {
    var color = 'var(' + SERIES_COLORS[si % SERIES_COLORS.length] + ')';
    var pts = s.points.filter(function (p) { return p.peak > 0; });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + x(p.gen).toFixed(1) + ' ' + y(p.peak).toFixed(1); }).join(' ');
    svg.appendChild(el('path', { d: d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

    s.points.forEach(function (p) {
      if (p.peak <= 0) return;
      var isAsc = p.stage > 0 && !s.points.some(function (q) { return q.gen < p.gen && q.stage === p.stage; });
      var r = isAsc ? 6 : 4;
      svg.appendChild(el('circle', {
        cx: x(p.gen), cy: y(p.peak), r: r,
        fill: isAsc ? 'var(--surface)' : color,
        stroke: color, 'stroke-width': isAsc ? 3 : 2
      }));
      hitData.push({ x: x(p.gen), y: y(p.peak), p: p, s: s, color: color });
    });

    // 最終点に直接ラベル
    var last = pts[pts.length - 1];
    if (last) {
      svg.appendChild(el('text', {
        x: x(last.gen) - 6, y: y(last.peak) - 12 - si * 16, fill: color, 'font-size': 12,
        'font-weight': 700, 'text-anchor': 'end'
      }, String(last.peak)));
    }
  });

  // --- 転生の発生点に注記 ---
  sets.forEach(function (s, si) {
    var first = null;
    for (var i = 1; i < s.points.length; i++) {
      if (s.points[i].stage > s.points[i - 1].stage) { first = s.points[i]; break; }
    }
    if (!first) return;
    var color = 'var(' + SERIES_COLORS[si % SERIES_COLORS.length] + ')';
    svg.appendChild(el('line', {
      x1: x(first.gen), x2: x(first.gen), y1: M.t, y2: M.t + ih,
      stroke: color, 'stroke-width': 1, 'stroke-dasharray': '2 5', opacity: 0.6
    }));
    var side = si % 2 === 0 ? -1 : 1;
    svg.appendChild(el('text', {
      x: x(first.gen) + side * 6,
      y: M.t + 12 + si * 16,
      fill: color, 'font-size': 11, 'font-weight': 600,
      'text-anchor': side < 0 ? 'end' : 'start'
    }, '第' + (first.stage + 1) + '転生'));
  });

  // --- ホバー ---
  var tip = document.getElementById('tip');
  var box = svg.parentNode;
  var hover = el('circle', { r: 9, fill: 'none', stroke: 'var(--ink-faint)', 'stroke-width': 1.5, opacity: 0 });
  svg.appendChild(hover);

  function onMove(ev) {
    var rect = svg.getBoundingClientRect();
    var cx = ((ev.clientX - rect.left) / rect.width) * W;
    var cy = ((ev.clientY - rect.top) / rect.height) * H;
    var best = null, bd = Infinity;
    hitData.forEach(function (h) {
      var dd = (h.x - cx) * (h.x - cx) + (h.y - cy) * (h.y - cy);
      if (dd < bd) { bd = dd; best = h; }
    });
    if (!best || bd > 2600) { tip.hidden = true; hover.setAttribute('opacity', 0); return; }
    hover.setAttribute('cx', best.x);
    hover.setAttribute('cy', best.y);
    hover.setAttribute('stroke', best.color);
    hover.setAttribute('opacity', 1);
    tip.hidden = false;
    tip.innerHTML =
      '<b>' + best.p.gen + '周目</b> · ' + best.s.label +
      '<dl>' +
      '<dt>到達</dt><dd>' + best.p.reached + '</dd>' +
      '<dt>ピーク総合力</dt><dd>' + best.p.peak + '</dd>' +
      '<dt>引退</dt><dd>' + best.p.retireAge + '歳</dd>' +
      '<dt>転生段階</dt><dd>' + best.p.stage + '</dd>' +
      '<dt>結晶強化</dt><dd>Lv' + best.p.legLv + '</dd>' +
      '</dl>';
    var px = (best.x / W) * rect.width;
    var py = (best.y / H) * rect.height;
    tip.style.left = Math.min(Math.max(px + 14, 0), rect.width - tip.offsetWidth - 4) + 'px';
    tip.style.top = Math.max(py - tip.offsetHeight - 10, 0) + 'px';
  }
  box.addEventListener('mousemove', onMove);
  box.addEventListener('mouseleave', function () { tip.hidden = true; hover.setAttribute('opacity', 0); });

  // --- 凡例 ---
  var legend = document.getElementById('legend');
  sets.forEach(function (s, si) {
    var sp = document.createElement('span');
    sp.innerHTML = '<i class="swatch" style="background:var(' + SERIES_COLORS[si % SERIES_COLORS.length] + ')"></i>' + s.label;
    legend.appendChild(sp);
  });
  var sp2 = document.createElement('span');
  sp2.innerHTML = '<i class="swatch dot" style="background:var(--surface);border:3px solid var(--ink-faint)"></i>第2転生の直後';
  legend.appendChild(sp2);

  // --- 読み取れること ---
  var findings = document.getElementById('findings');
  sets.forEach(function (s) {
    var last = s.points[s.points.length - 1];
    var li = document.createElement('li');
    li.textContent = s.label + '：' + s.generations + '周で ' + last.reached + '（ピーク ' + last.peak + '）。' +
      (s.ascensionEvents.length ? s.ascensionEvents[0] : '第2転生なし');
    findings.appendChild(li);
  });
  if (sets.length >= 2) {
    var a = sets[0].points[sets[0].points.length - 1].peak;
    var b = sets[1].points[sets[1].points.length - 1].peak;
    var li2 = document.createElement('li');
    li2.textContent = '最終到達の差は ' + Math.abs(a - b) + '（' + (a >= b ? sets[0].label : sets[1].label) + ' が上）。';
    findings.appendChild(li2);
  }

  // --- 表 ---
  var table = document.getElementById('table');
  var head = '<thead><tr><th>周回</th><th>戦略</th><th>段階</th><th>到達</th><th>ピーク</th><th>引退</th><th>強化Lv</th><th>聖杯</th></tr></thead>';
  var rows = '';
  var maxLen = Math.max.apply(null, sets.map(function (s) { return s.points.length; }));
  for (var i = 0; i < maxLen; i++) {
    sets.forEach(function (s) {
      var p = s.points[i];
      if (!p) return;
      var prev = i > 0 ? s.points[i - 1] : null;
      var asc = prev && p.stage > prev.stage;
      rows += '<tr' + (asc ? ' class="ascend"' : '') + '><td>' + p.gen + '</td><td>' + s.label + '</td><td>' + p.stage +
        '</td><td>' + p.reached + '</td><td>' + p.peak + '</td><td>' + p.retireAge + '</td><td>' + p.legLv + '</td><td>' + p.holy + '</td></tr>';
    });
  }
  table.innerHTML = head + '<tbody>' + rows + '</tbody>';

  document.getElementById('foot').textContent =
    sets.map(function (s) { return s.label + ' は合計 ' + s.totalMonths + ' ゲーム内月（1倍速で約 ' + Math.round(s.totalMonths / 60) + ' 分）'; }).join(' / ');
})();
</script>
`;

writeFileSync('curve-chart.html', html, 'utf8');
console.log('curve-chart.html を書き出した（データ: ' + strategies.join(', ') + '）');
