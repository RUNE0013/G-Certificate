"use strict";
(function () {
  // ───────── データ準備 ─────────
  const CATS = window.CATEGORIES;
  const CAT = {};
  CATS.forEach((c) => (CAT[c.id] = c));

  const seq = {};
  const QS = window.QUESTIONS.map((q) => {
    seq[q.c] = (seq[q.c] || 0) + 1;
    return Object.assign({ id: q.c + "-" + seq[q.c] }, q);
  });
  const QMAP = {};
  QS.forEach((q) => (QMAP[q.id] = q));
  const GL = window.GLOSSARY;

  // 本試験の目安（100分・約145問）から1問あたりの秒数を換算
  const SEC_PER_Q = (100 * 60) / 145;

  // ───────── 保存データ ─────────
  const KEY = "gken-study-v1";
  const blank = () => ({ q: {}, bm: [], known: [], exams: [], days: {} });
  let S = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return Object.assign(blank(), JSON.parse(raw));
    } catch (e) { /* 利用不可でもメモリ上で動作させる */ }
    return blank();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* noop */ }
  }
  function record(id, ok) {
    const r = S.q[id] || (S.q[id] = { c: 0, w: 0 });
    if (ok) r.c++; else r.w++;
    r.last = ok ? 1 : 0;
    r.ts = Date.now();
    const d = dayKey();
    S.days[d] = (S.days[d] || 0) + 1;
    save();
  }
  const isBm = (id) => S.bm.includes(id);
  function toggleBm(id) {
    S.bm = isBm(id) ? S.bm.filter((x) => x !== id) : S.bm.concat(id);
    save();
  }
  const isKnown = (t) => S.known.includes(t);
  function setKnown(t, v) {
    S.known = S.known.filter((x) => x !== t);
    if (v) S.known.push(t);
    save();
  }

  // ───────── ユーティリティ ─────────
  const app = document.getElementById("app");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const KEYS = ["A", "B", "C", "D"];

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function dayKey(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function fmtSec(sec) {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + String(s).padStart(2, "0");
  }
  function fmtDate(ts) {
    const d = new Date(ts);
    return (d.getMonth() + 1) + "/" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function streak() {
    let n = 0;
    const d = new Date();
    if (!S.days[dayKey(d)]) d.setDate(d.getDate() - 1);
    while (S.days[dayKey(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  const status = (id) => { const r = S.q[id]; return !r ? "new" : r.last ? "ok" : "ng"; };

  // 未回答・前回不正解・正解回数の少ない問題を優先して選ぶ
  function prioritized(qs, n) {
    const score = (q) => {
      const r = S.q[q.id];
      if (!r) return 2;
      if (!r.last) return 3;
      return Math.max(0, 1 - r.c * 0.25);
    };
    return shuffle(shuffle(qs).sort((a, b) => score(b) - score(a)).slice(0, n));
  }
  // 分野が偏らないように抽出
  function stratified(n) {
    const pools = shuffle(CATS).map((c) => shuffle(QS.filter((q) => q.c === c.id)));
    const out = [];
    while (out.length < n && pools.some((p) => p.length)) {
      pools.forEach((p) => { if (p.length && out.length < n) out.push(p.pop()); });
    }
    return shuffle(out);
  }

  function catStats(catId) {
    const qs = catId ? QS.filter((q) => q.c === catId) : QS;
    let ok = 0, ng = 0, c = 0, w = 0;
    qs.forEach((q) => {
      const r = S.q[q.id];
      if (!r) return;
      if (r.last) ok++; else ng++;
      c += r.c; w += r.w;
    });
    return { total: qs.length, ok, ng, answered: ok + ng, c, w };
  }

  // ───────── セッション / ルーティング ─────────
  let session = null;
  let timer = null;
  let curPath = "";

  // hashchange を待たずに同期的に描画する（pushState は hashchange を発火しない）
  function go(path, replace) {
    const h = "#/" + path;
    if (location.hash !== h) history[replace ? "replaceState" : "pushState"](null, "", h);
    render();
  }
  function makeItems(qs) {
    return qs.map((q) => ({ id: q.id, order: shuffle([0, 1, 2, 3]), pick: null, flag: false }));
  }
  function startPractice(qs, label) {
    if (!qs.length) return;
    session = { mode: "practice", label, items: makeItems(qs), i: 0, start: Date.now() };
    go("quiz");
  }

  const routes = {
    "": viewHome,
    practice: viewPractice,
    quiz: viewQuiz,
    exam: viewExamSetup,
    "exam-run": viewExamRun,
    result: viewResult,
    glossary: viewGlossary,
    stats: viewStats,
  };
  const NAV = { "": "home", practice: "practice", quiz: "practice", exam: "exam", "exam-run": "exam", result: "", glossary: "glossary", stats: "stats" };

  function parseHash() {
    const [path, qs] = location.hash.replace(/^#\/?/, "").split("?");
    return { path: routes[path] ? path : "", params: new URLSearchParams(qs || "") };
  }

  window.addEventListener("hashchange", () => {
    const { path } = parseHash();
    if (curPath === "exam-run" && path !== "exam-run" && session && session.mode === "exam" && !session.done) {
      if (!confirm("模擬試験を中断しますか？（結果は保存されません）")) {
        history.replaceState(null, "", "#/exam-run");
        return;
      }
      session = null;
    }
    render();
  });

  function render() {
    clearInterval(timer);
    timer = null;
    document.onkeydown = null;
    app.onclick = null;
    app.oninput = null;
    app.onchange = null;
    const { path, params } = parseHash();
    curPath = path;
    document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.r === NAV[path]));
    routes[path](params);
    window.scrollTo(0, 0);
  }

  // data-act 属性によるイベント委譲
  function onAct(handlers) {
    app.onclick = (e) => {
      const el = e.target.closest("[data-act]");
      if (!el || !app.contains(el)) return;
      const fn = handlers[el.dataset.act];
      if (fn) fn(el, e);
    };
  }

  // ───────── ホーム ─────────
  function viewHome() {
    const all = catStats();
    const wrongQs = QS.filter((q) => status(q.id) === "ng");
    const newQs = QS.filter((q) => status(q.id) === "new");
    const todayN = S.days[dayKey()] || 0;
    const mastery = pct(all.ok, all.total);
    const lastExam = S.exams[S.exams.length - 1];

    app.innerHTML = `
      <div class="hero">
        <div class="card hero-main">
          <div>
            <h1>今日も一歩ずつ。</h1>
            <p>全${QS.length}問・${CATS.length}分野。前回正解した問題の割合を「習得率」として記録します。</p>
          </div>
          <div class="hero-ring">
            <div class="ring" style="--p:${mastery}"><div><div><strong>${mastery}%</strong><small>習得率</small></div></div></div>
            <div class="ring-legend">
              <div>習得済み <b>${all.ok}</b> 問</div>
              <div>要復習 <b>${all.ng}</b> 問</div>
              <div>未回答 <b>${all.total - all.answered}</b> 問</div>
            </div>
          </div>
        </div>
        <div class="stat-grid">
          <div class="card stat"><div class="stat-label">今日の解答数</div><div class="stat-value">${todayN}<small>問</small></div></div>
          <div class="card stat"><div class="stat-label">連続学習</div><div class="stat-value">${streak()}<small>日</small></div></div>
          <div class="card stat"><div class="stat-label">通算正答率</div><div class="stat-value">${pct(all.c, all.c + all.w)}<small>%</small></div></div>
          <div class="card stat"><div class="stat-label">前回の模擬試験</div><div class="stat-value">${lastExam ? pct(lastExam.score, lastExam.n) + "<small>%</small>" : "<small>未受験</small>"}</div></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">すぐに始める</div>
        <div class="quick">
          <button class="card quick-item" data-act="auto">
            <span class="count">10問</span>
            <h3>おまかせ演習</h3>
            <p>未回答・間違えた問題を優先して出題します。</p>
          </button>
          <button class="card quick-item" data-act="wrong" ${wrongQs.length ? "" : "disabled"}>
            <span class="count">${wrongQs.length}問</span>
            <h3>苦手を復習</h3>
            <p>前回不正解だった問題だけを解き直します。</p>
          </button>
          <button class="card quick-item" data-act="exam">
            <span class="count">時間制限あり</span>
            <h3>模擬試験</h3>
            <p>本番と同じペースで、分野横断の問題に挑戦します。</p>
          </button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">分野別の習得状況 <a href="#/practice">条件を指定して演習</a></div>
        <div class="cat-list">
          ${CATS.map((c) => {
            const s = catStats(c.id);
            return `<button class="cat-row" data-act="cat" data-id="${c.id}">
              <span class="cat-name">${esc(c.name)}</span>
              <span class="cat-num">${s.ok} / ${s.total}</span>
              <span class="bar"><i class="b-ok" style="width:${pct(s.ok, s.total)}%"></i><i class="b-ng" style="width:${pct(s.ng, s.total)}%"></i></span>
            </button>`;
          }).join("")}
        </div>
      </div>
      ${newQs.length === QS.length ? `<p class="note">学習データはこのブラウザ内（localStorage）にのみ保存されます。</p>` : ""}
    `;

    onAct({
      auto: () => startPractice(prioritized(QS, 10), "おまかせ演習"),
      wrong: () => startPractice(shuffle(wrongQs), "苦手を復習"),
      exam: () => go("exam"),
      cat: (el) => startPractice(prioritized(QS.filter((q) => q.c === el.dataset.id), 10), CAT[el.dataset.id].name),
    });
  }

  // ───────── 演習の設定 ─────────
  function viewPractice(params) {
    const pre = params.get("cat");
    const st = {
      cats: new Set(pre && CAT[pre] ? [pre] : CATS.map((c) => c.id)),
      filter: "all",
      count: 10,
    };
    const FILTERS = [
      ["all", "すべて"],
      ["new", "未回答"],
      ["ng", "前回不正解"],
      ["bm", "ブックマーク"],
    ];
    const COUNTS = [10, 20, 30, 0];

    const pool = () => QS.filter((q) => {
      if (!st.cats.has(q.c)) return false;
      if (st.filter === "new") return status(q.id) === "new";
      if (st.filter === "ng") return status(q.id) === "ng";
      if (st.filter === "bm") return isBm(q.id);
      return true;
    });

    function draw() {
      const p = pool();
      const n = st.count ? Math.min(st.count, p.length) : p.length;
      app.innerHTML = `
        <div class="narrow">
          <div class="page-head">
            <h1>分野別演習</h1>
            <p>1問ごとに正誤と解説を表示します。</p>
          </div>
          <div class="card">
            <div class="field">
              <div class="field-label">分野
                <span><button class="link-btn" data-act="all">すべて選択</button> ・ <button class="link-btn" data-act="none">解除</button></span>
              </div>
              <div class="chips">
                ${CATS.map((c) => `<button class="chip" data-act="cat" data-id="${c.id}" aria-pressed="${st.cats.has(c.id)}">${esc(c.name)}<small>${QS.filter((q) => q.c === c.id).length}</small></button>`).join("")}
              </div>
            </div>
            <div class="field">
              <div class="field-label">出題対象</div>
              <div class="chips">
                ${FILTERS.map(([k, l]) => `<button class="chip" data-act="filter" data-k="${k}" aria-pressed="${st.filter === k}">${l}</button>`).join("")}
              </div>
            </div>
            <div class="field">
              <div class="field-label">問題数</div>
              <div class="chips">
                ${COUNTS.map((k) => `<button class="chip" data-act="count" data-k="${k}" aria-pressed="${st.count === k}">${k ? k + "問" : "全問"}</button>`).join("")}
              </div>
            </div>
            <div class="setup-foot">
              <span class="avail">対象 <b>${p.length}</b> 問 → <b>${n}</b> 問を出題</span>
              <button class="btn btn-primary" data-act="start" ${n ? "" : "disabled"}>演習を始める</button>
            </div>
          </div>
        </div>`;
    }

    onAct({
      all: () => { CATS.forEach((c) => st.cats.add(c.id)); draw(); },
      none: () => { st.cats.clear(); draw(); },
      cat: (el) => { const id = el.dataset.id; st.cats.has(id) ? st.cats.delete(id) : st.cats.add(id); draw(); },
      filter: (el) => { st.filter = el.dataset.k; draw(); },
      count: (el) => { st.count = Number(el.dataset.k); draw(); },
      start: () => {
        const p = pool();
        const qs = st.filter === "all" ? prioritized(p, st.count || p.length) : shuffle(p).slice(0, st.count || p.length);
        startPractice(qs, st.cats.size === 1 ? CAT[[...st.cats][0]].name : "分野別演習");
      },
    });
    draw();
  }

  // ───────── 演習（1問ずつ） ─────────
  function viewQuiz() {
    if (!session || session.mode !== "practice") return go("", true);

    function choicesHtml(it, q, reveal) {
      return it.order.map((k, pos) => {
        let cls = "choice", mark = "";
        if (reveal) {
          if (k === 0) { cls += " is-correct"; mark = "正解"; }
          else if (k === it.pick) { cls += " is-wrong"; mark = "あなたの解答"; }
          else cls += " is-dim";
        } else if (k === it.pick) cls += " is-selected";
        return `<button class="${cls}" data-act="pick" data-k="${k}" ${reveal ? "disabled" : ""}>
          <span class="choice-key">${KEYS[pos]}</span><span>${esc(q.a[k])}</span><span class="choice-mark">${mark}</span>
        </button>`;
      }).join("");
    }

    function draw() {
      const it = session.items[session.i];
      const q = QMAP[it.id];
      const answered = it.pick !== null;
      const ok = it.pick === 0;
      const total = session.items.length;
      const last = session.i === total - 1;
      app.innerHTML = `
        <div class="narrow">
          <div class="quiz-top">
            <span class="tag">${esc(CAT[q.c].name)}</span>
            <span class="grow"></span>
            <span class="quiz-count">${session.i + 1} / ${total}</span>
            <button class="bm-btn" data-act="bm" aria-pressed="${isBm(q.id)}">${isBm(q.id) ? "★ 保存済み" : "☆ 保存"}</button>
          </div>
          <div class="progress"><i style="width:${pct(session.i + (answered ? 1 : 0), total)}%"></i></div>
          <div class="card q-card">
            <p class="q-text">${esc(q.q)}</p>
            <div class="choices">${choicesHtml(it, q, answered)}</div>
            ${answered ? `<div class="feedback ${ok ? "ok" : "ng"}" role="status">
              <div class="feedback-head">${ok ? "正解" : "不正解"}</div>
              <p>${esc(q.e)}</p>
            </div>` : ""}
          </div>
          <div class="quiz-actions">
            <button class="btn btn-ghost btn-sm" data-act="quit">終了する</button>
            <span class="kbd-hint"><kbd>A</kbd>〜<kbd>D</kbd> / <kbd>1</kbd>〜<kbd>4</kbd> で解答、<kbd>Enter</kbd> で次へ</span>
            ${answered ? `<button class="btn btn-primary" data-act="next" id="nextBtn">${last ? "結果を見る" : "次の問題"}</button>` : ""}
          </div>
        </div>`;
      if (answered) document.getElementById("nextBtn").focus({ preventScroll: true });
    }

    function pick(k) {
      const it = session.items[session.i];
      if (it.pick !== null) return;
      it.pick = k;
      record(it.id, k === 0);
      draw();
    }
    function next() {
      const it = session.items[session.i];
      if (it.pick === null) return;
      if (session.i < session.items.length - 1) {
        session.i++;
        draw();
        window.scrollTo(0, 0);
      } else finish();
    }
    function finish() {
      session.done = true;
      session.end = Date.now();
      go("result");
    }

    onAct({
      pick: (el) => pick(Number(el.dataset.k)),
      next,
      bm: () => { toggleBm(session.items[session.i].id); draw(); },
      quit: () => {
        const done = session.items.filter((x) => x.pick !== null).length;
        if (!done) return go("", true);
        session.items = session.items.filter((x) => x.pick !== null);
        finish();
      },
    });
    document.onkeydown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const it = session.items[session.i];
      const key = e.key.toUpperCase();
      let pos = KEYS.indexOf(key);
      if (pos < 0 && /^[1-4]$/.test(e.key)) pos = Number(e.key) - 1;
      if (pos >= 0 && it.pick === null) { e.preventDefault(); pick(it.order[pos]); }
      else if ((e.key === "Enter" || e.key === "ArrowRight") && it.pick !== null) { e.preventDefault(); next(); }
    };
    draw();
  }

  // ───────── 模擬試験の設定 ─────────
  function viewExamSetup() {
    const presets = [
      { n: 30, label: "ミニ", sub: "スキマ時間に" },
      { n: 70, label: "ハーフ", sub: "本番の約半分" },
      { n: QS.length, label: "フル", sub: "収録問題をすべて出題" },
    ].map((p) => Object.assign(p, { n: Math.min(p.n, QS.length), min: Math.ceil((Math.min(p.n, QS.length) * SEC_PER_Q) / 60) }));

    const hist = S.exams.slice(-5).reverse();
    app.innerHTML = `
      <div class="narrow">
        <div class="page-head">
          <h1>模擬試験</h1>
          <p>制限時間内に解答し、最後にまとめて採点します。途中で問題を行き来したり、見直しの印を付けたりできます。</p>
        </div>
        <div class="preset-list">
          ${presets.map((p, i) => `<button class="card preset" data-act="start" data-i="${i}">
            <h3>${p.label}</h3>
            <span class="meta">${p.n}問 ・ ${p.min}分</span>
            <span class="sub">${p.sub}</span>
          </button>`).join("")}
        </div>
        <p class="note">制限時間は本試験の目安（100分・約145問）から1問あたり約41秒で換算しています。分野が偏らないように出題します。合格基準は公表されていないため、本アプリでは正答率70%を目安として表示します。</p>

        <div class="section">
          <div class="section-title">最近の受験結果</div>
          ${hist.length ? `<div class="card"><div class="table-wrap"><table class="table">
            <thead><tr><th>日時</th><th class="num">問題数</th><th class="num">正答率</th><th class="num">所要時間</th></tr></thead>
            <tbody>${hist.map((x) => `<tr><td>${fmtDate(x.ts)}</td><td class="num">${x.n}</td><td class="num ${pct(x.score, x.n) >= 70 ? "t-ok" : "t-ng"}">${pct(x.score, x.n)}%</td><td class="num">${fmtSec(x.sec)}</td></tr>`).join("")}</tbody>
          </table></div></div>` : `<div class="card empty">まだ受験記録はありません。</div>`}
        </div>
      </div>`;

    onAct({
      start: (el) => {
        const p = presets[Number(el.dataset.i)];
        session = {
          mode: "exam", items: makeItems(stratified(p.n)), i: 0,
          start: Date.now(), limit: p.min * 60, endAt: Date.now() + p.min * 60000, showGrid: false,
        };
        go("exam-run");
      },
    });
  }

  // ───────── 模擬試験の実施 ─────────
  function viewExamRun() {
    if (!session || session.mode !== "exam" || session.done) return go("exam", true);

    const remain = () => (session.endAt - Date.now()) / 1000;

    function draw() {
      const it = session.items[session.i];
      const q = QMAP[it.id];
      const total = session.items.length;
      const done = session.items.filter((x) => x.pick !== null).length;
      app.innerHTML = `
        <div class="narrow">
          <div class="exam-bar">
            <span class="timer ${remain() < 300 ? "low" : ""}" id="timer" aria-label="残り時間">${fmtSec(remain())}</span>
            <span class="answered">解答済み ${done} / ${total}</span>
            <span class="grow"></span>
            <button class="btn btn-sm" data-act="grid">${session.showGrid ? "一覧を閉じる" : "問題一覧"}</button>
            <button class="btn btn-sm btn-primary" data-act="submit">採点する</button>
          </div>
          ${session.showGrid ? `
            <div class="legend"><span class="l-done">解答済み</span><span class="l-flag">見直し</span><span class="l-none">未解答</span></div>
            <div class="grid-panel">
              ${session.items.map((x, i) => `<button data-act="jump" data-i="${i}" class="${x.pick !== null ? "done" : ""} ${x.flag ? "flag" : ""} ${i === session.i ? "cur" : ""}">${i + 1}</button>`).join("")}
            </div>` : ""}
          <div class="quiz-top">
            <span class="tag">${esc(CAT[q.c].name)}</span>
            <span class="grow"></span>
            <span class="quiz-count">問 ${session.i + 1} / ${total}</span>
            <button class="flag-btn" data-act="flag" aria-pressed="${it.flag}">${it.flag ? "見直し中" : "見直す"}</button>
          </div>
          <div class="card q-card">
            <p class="q-text">${esc(q.q)}</p>
            <div class="choices">
              ${it.order.map((k, pos) => `<button class="choice ${k === it.pick ? "is-selected" : ""}" data-act="pick" data-k="${k}">
                <span class="choice-key">${KEYS[pos]}</span><span>${esc(q.a[k])}</span><span></span>
              </button>`).join("")}
            </div>
          </div>
          <div class="quiz-actions">
            <button class="btn" data-act="prev" ${session.i === 0 ? "disabled" : ""}>前へ</button>
            <span class="kbd-hint"><kbd>A</kbd>〜<kbd>D</kbd> で解答、<kbd>←</kbd><kbd>→</kbd> で移動、<kbd>F</kbd> で見直し</span>
            <button class="btn ${session.i === total - 1 ? "" : "btn-primary"}" data-act="next" ${session.i === total - 1 ? "disabled" : ""}>次へ</button>
          </div>
        </div>`;
    }

    function move(d) {
      const n = session.i + d;
      if (n < 0 || n >= session.items.length) return;
      session.i = n;
      draw();
    }
    function submit(force) {
      if (!force) {
        const left = session.items.filter((x) => x.pick === null).length;
        const msg = left ? `未解答が ${left} 問あります。採点しますか？` : "採点しますか？";
        if (!confirm(msg)) return;
      }
      finishExam();
    }

    onAct({
      pick: (el) => { session.items[session.i].pick = Number(el.dataset.k); draw(); },
      prev: () => move(-1),
      next: () => move(1),
      flag: () => { const it = session.items[session.i]; it.flag = !it.flag; draw(); },
      grid: () => { session.showGrid = !session.showGrid; draw(); },
      jump: (el) => { session.i = Number(el.dataset.i); draw(); },
      submit: () => submit(false),
    });
    document.onkeydown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const it = session.items[session.i];
      const key = e.key.toUpperCase();
      let pos = KEYS.indexOf(key);
      if (pos < 0 && /^[1-4]$/.test(e.key)) pos = Number(e.key) - 1;
      if (pos >= 0) { e.preventDefault(); it.pick = it.order[pos]; draw(); }
      else if (e.key === "ArrowRight") move(1);
      else if (e.key === "ArrowLeft") move(-1);
      else if (key === "F") { it.flag = !it.flag; draw(); }
    };
    timer = setInterval(() => {
      const r = remain();
      const el = document.getElementById("timer");
      if (el) { el.textContent = fmtSec(r); el.classList.toggle("low", r < 300); }
      if (r <= 0) {
        clearInterval(timer);
        alert("制限時間になりました。採点します。");
        submit(true);
      }
    }, 500);
    draw();
  }

  function finishExam() {
    session.done = true;
    session.end = Math.min(Date.now(), session.endAt);
    const by = {};
    let score = 0;
    session.items.forEach((it) => {
      const q = QMAP[it.id];
      const ok = it.pick === 0;
      if (it.pick !== null) record(it.id, ok);
      if (ok) score++;
      by[q.c] = by[q.c] || [0, 0];
      by[q.c][1]++;
      if (ok) by[q.c][0]++;
    });
    S.exams.push({ ts: Date.now(), n: session.items.length, score, sec: Math.round((session.end - session.start) / 1000), by });
    S.exams = S.exams.slice(-50);
    save();
    go("result");
  }

  // ───────── 結果 ─────────
  function viewResult() {
    if (!session || !session.done) return go("", true);
    const items = session.items;
    const total = items.length;
    const okN = items.filter((x) => x.pick === 0).length;
    const rate = pct(okN, total);
    const isExam = session.mode === "exam";
    const sec = Math.round((session.end - session.start) / 1000);
    const wrong = items.filter((x) => x.pick !== 0).map((x) => QMAP[x.id]);

    const by = {};
    items.forEach((it) => {
      const c = QMAP[it.id].c;
      by[c] = by[c] || [0, 0];
      by[c][1]++;
      if (it.pick === 0) by[c][0]++;
    });
    const catIds = CATS.map((c) => c.id).filter((id) => by[id]);

    app.innerHTML = `
      <div class="narrow">
        <div class="page-head">
          <h1>${isExam ? "模擬試験の結果" : "演習の結果"}</h1>
          <p>${isExam ? "" : esc(session.label)}</p>
        </div>
        <div class="card result-hero">
          <div class="result-score">${rate}<small>%</small></div>
          <div class="result-meta">
            ${isExam ? `<span class="verdict ${rate >= 70 ? "ok" : "ng"}">${rate >= 70 ? "目安の70%を超えました" : "目安の70%まであと少し"}</span>` : ""}
            <span>${total}問中 <b>${okN}</b> 問正解</span>
            <span>所要時間 ${fmtSec(sec)}${isExam ? ` / 制限 ${fmtSec(session.limit)}` : ""}</span>
          </div>
        </div>

        <div class="btn-row section" style="margin-top:18px">
          ${wrong.length ? `<button class="btn btn-primary" data-act="retry">間違えた ${wrong.length} 問を解き直す</button>` : ""}
          <button class="btn" data-act="home">ホームへ</button>
        </div>

        ${catIds.length > 1 ? `<div class="section">
          <div class="section-title">分野別</div>
          <div class="card"><div class="table-wrap"><table class="table">
            <thead><tr><th>分野</th><th class="num">正解</th><th class="num">正答率</th></tr></thead>
            <tbody>${catIds.map((id) => { const [c, n] = by[id]; return `<tr><td>${esc(CAT[id].name)}</td><td class="num">${c} / ${n}</td><td class="num">${pct(c, n)}%<span class="mini-bar"><i style="width:${pct(c, n)}%"></i></span></td></tr>`; }).join("")}</tbody>
          </table></div></div>
        </div>` : ""}

        <div class="section">
          <div class="section-title">解答の振り返り</div>
          <div class="review">
            ${items.map((it) => {
              const q = QMAP[it.id];
              const st = it.pick === null ? "na" : it.pick === 0 ? "ok" : "ng";
              const label = { ok: "正", ng: "誤", na: "未" }[st];
              return `<details>
                <summary><span class="badge ${st}">${label}</span><span>${esc(q.q)}</span></summary>
                <div class="body">
                  <div class="ans">
                    <span>正解：<span class="t-ok">${esc(q.a[0])}</span></span>
                    ${st === "ng" ? `<span>あなたの解答：<span class="t-ng">${esc(q.a[it.pick])}</span></span>` : ""}
                    ${st === "na" ? `<span class="t-ng">未解答</span>` : ""}
                  </div>
                  <div class="exp">${esc(q.e)}</div>
                  <div><button class="bm-btn" data-act="bm" data-id="${q.id}" aria-pressed="${isBm(q.id)}">${isBm(q.id) ? "★ 保存済み" : "☆ 保存"}</button></div>
                </div>
              </details>`;
            }).join("")}
          </div>
        </div>
      </div>`;

    onAct({
      retry: () => startPractice(shuffle(wrong), "間違えた問題の解き直し"),
      home: () => go(""),
      bm: (el) => {
        toggleBm(el.dataset.id);
        const on = isBm(el.dataset.id);
        el.setAttribute("aria-pressed", on);
        el.textContent = on ? "★ 保存済み" : "☆ 保存";
      },
    });
  }

  // ───────── 用語集 ─────────
  const glState = { q: "", cat: "all", mode: "list", unknownOnly: false, i: 0, flipped: false };

  function viewGlossary() {
    const st = glState;
    const filtered = () => {
      const kw = st.q.trim().toLowerCase();
      return GL.filter((g) =>
        (st.cat === "all" || g.c === st.cat) &&
        (!st.unknownOnly || !isKnown(g.t)) &&
        (!kw || g.t.toLowerCase().includes(kw) || g.d.toLowerCase().includes(kw)));
    };
    const hl = (s) => {
      const kw = st.q.trim();
      const e = esc(s);
      if (!kw) return e;
      const k = esc(kw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return e.replace(new RegExp(k, "gi"), (m) => `<mark>${m}</mark>`);
    };

    function listHtml(list) {
      if (!list.length) return `<div class="card empty">該当する用語がありません。</div>`;
      return `<div class="gl-list">${list.map((g) => `
        <div class="card gl-item">
          <div class="gl-item-head"><h3>${hl(g.t)}</h3><button class="known-btn" data-act="known" data-t="${esc(g.t)}" aria-pressed="${isKnown(g.t)}">${isKnown(g.t) ? "覚えた" : "未習得"}</button></div>
          <p>${hl(g.d)}</p>
          <div class="foot"><span class="tag">${esc(CAT[g.c].short)}</span></div>
        </div>`).join("")}</div>`;
    }

    function cardHtml(list) {
      if (!list.length) return `<div class="card empty">${st.unknownOnly ? "すべて覚えました。「未習得のみ」を外すと全カードを復習できます。" : "該当する用語がありません。"}</div>`;
      st.i = Math.min(st.i, list.length - 1);
      const g = list[st.i];
      return `<div class="flash-wrap">
        <button class="flash ${st.flipped ? "flipped" : ""}" data-act="flip" aria-label="カードをめくる">
          <div class="flash-inner">
            <div class="flash-face"><span class="tag">${esc(CAT[g.c].name)}</span><h2>${esc(g.t)}</h2><span class="hint">タップ / Space で意味を表示</span></div>
            <div class="flash-face flash-back"><h3>${esc(g.t)}</h3><p>${esc(g.d)}</p></div>
          </div>
        </button>
        <div class="flash-nav">
          <button class="btn" data-act="prev" ${st.i === 0 ? "disabled" : ""}>前へ</button>
          <span class="flash-pos">${st.i + 1} / ${list.length}${isKnown(g.t) ? " ・ 覚えた" : ""}</span>
          <span class="btn-row">
            <button class="btn" data-act="mark" data-v="0">まだ</button>
            <button class="btn btn-primary" data-act="mark" data-v="1">覚えた</button>
          </span>
        </div>
      </div>`;
    }

    let order = null; // カードのシャッフル順（用語名の配列）
    function currentList() {
      const list = filtered();
      if (st.mode !== "card" || !order) return list;
      const rank = new Map(order.map((t, i) => [t, i]));
      return list.slice().sort((a, b) => rank.get(a.t) - rank.get(b.t));
    }
    function drawCount() {
      document.getElementById("glCount").textContent = `${currentList().length}語 ・ 覚えた ${GL.filter((g) => isKnown(g.t)).length} / ${GL.length}`;
    }
    function drawBody() {
      const list = currentList();
      drawCount();
      document.getElementById("glBody").innerHTML = st.mode === "list" ? listHtml(list) : cardHtml(list);
    }

    function draw() {
      app.innerHTML = `
        <div class="page-head">
          <h1>用語集</h1>
          <p>一覧で調べる・カードで覚える。「覚えた」の記録はこのブラウザに保存されます。</p>
        </div>
        <div class="gl-tools">
          <input class="search" id="glSearch" type="search" placeholder="用語や説明を検索（例：Attention、個人情報）" value="${esc(st.q)}" aria-label="用語を検索">
          <div class="chips">
            <button class="chip" data-act="cat" data-id="all" aria-pressed="${st.cat === "all"}">すべて</button>
            ${CATS.map((c) => `<button class="chip" data-act="cat" data-id="${c.id}" aria-pressed="${st.cat === c.id}">${esc(c.short)}</button>`).join("")}
          </div>
          <div class="row">
            <span class="seg">
              <button data-act="mode" data-m="list" aria-pressed="${st.mode === "list"}">一覧</button>
              <button data-act="mode" data-m="card" aria-pressed="${st.mode === "card"}">カード</button>
            </span>
            <span class="chips">
              <button class="chip" data-act="unknown" aria-pressed="${st.unknownOnly}">未習得のみ</button>
              ${st.mode === "card" ? `<button class="chip" data-act="shuffle">シャッフル</button>` : ""}
            </span>
            <span class="gl-count" id="glCount"></span>
          </div>
        </div>
        <div id="glBody"></div>`;
      drawBody();
    }

    function step(d) {
      const n = currentList().length;
      const ni = st.i + d;
      if (ni < 0 || ni >= n) return;
      st.i = ni;
      st.flipped = false;
      drawBody();
    }

    app.oninput = (e) => {
      if (e.target.id === "glSearch") { st.q = e.target.value; drawBody(); }
    };
    onAct({
      cat: (el) => { st.cat = el.dataset.id; st.i = 0; st.flipped = false; draw(); },
      mode: (el) => { st.mode = el.dataset.m; st.i = 0; st.flipped = false; draw(); },
      unknown: () => { st.unknownOnly = !st.unknownOnly; st.i = 0; st.flipped = false; draw(); },
      shuffle: () => { order = shuffle(GL.map((g) => g.t)); st.i = 0; st.flipped = false; drawBody(); },
      known: (el) => {
        const t = el.dataset.t;
        setKnown(t, !isKnown(t));
        if (st.unknownOnly) drawBody();
        else {
          el.setAttribute("aria-pressed", isKnown(t));
          el.textContent = isKnown(t) ? "覚えた" : "未習得";
          drawCount();
        }
      },
      flip: () => { st.flipped = !st.flipped; app.querySelector(".flash").classList.toggle("flipped", st.flipped); },
      prev: () => step(-1),
      mark: (el) => {
        const list = currentList();
        const g = list[st.i];
        if (!g) return;
        setKnown(g.t, el.dataset.v === "1");
        st.flipped = false;
        // 「未習得のみ」で覚えた場合は一覧から外れるので位置を進めない
        const removed = st.unknownOnly && el.dataset.v === "1";
        if (!removed && st.i < list.length - 1) st.i++;
        drawBody();
      },
    });
    document.onkeydown = (e) => {
      if (st.mode !== "card" || e.target.tagName === "INPUT") return;
      if (e.key === " ") { e.preventDefault(); st.flipped = !st.flipped; const f = app.querySelector(".flash"); if (f) f.classList.toggle("flipped", st.flipped); }
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    draw();
  }

  // ───────── 学習記録 ─────────
  function viewStats() {
    const all = catStats();
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push({ d, n: S.days[dayKey(d)] || 0 });
    }
    const maxN = Math.max(1, ...days.map((x) => x.n));
    const exams = S.exams.slice().reverse();

    app.innerHTML = `
      <div class="page-head">
        <h1>学習記録</h1>
        <p>記録はこのブラウザにのみ保存されます。別の端末へ移すときはエクスポート / インポートを使ってください。</p>
      </div>

      <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
        <div class="card stat"><div class="stat-label">通算解答数</div><div class="stat-value">${all.c + all.w}<small>問</small></div></div>
        <div class="card stat"><div class="stat-label">通算正答率</div><div class="stat-value">${pct(all.c, all.c + all.w)}<small>%</small></div></div>
        <div class="card stat"><div class="stat-label">習得率</div><div class="stat-value">${pct(all.ok, all.total)}<small>%</small></div></div>
        <div class="card stat"><div class="stat-label">連続学習</div><div class="stat-value">${streak()}<small>日</small></div></div>
      </div>

      <div class="section">
        <div class="section-title">直近14日間の解答数</div>
        <div class="card">
          <div class="days">
            ${days.map((x) => `<div class="day" title="${x.d.getMonth() + 1}/${x.d.getDate()}：${x.n}問"><i class="${x.n ? "" : "zero"}" style="height:${x.n ? Math.max(6, (x.n / maxN) * 100) : 3}%"></i><span>${x.d.getDate()}</span></div>`).join("")}
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">分野別</div>
        <div class="card"><div class="table-wrap"><table class="table">
          <thead><tr><th>分野</th><th class="num">習得</th><th class="num">要復習</th><th class="num">正答率</th><th></th></tr></thead>
          <tbody>${CATS.map((c) => {
            const s = catStats(c.id);
            return `<tr><td>${esc(c.name)}</td><td class="num">${s.ok} / ${s.total}<span class="mini-bar"><i style="width:${pct(s.ok, s.total)}%"></i></span></td><td class="num">${s.ng}</td><td class="num">${s.c + s.w ? pct(s.c, s.c + s.w) + "%" : "—"}</td><td class="num"><a href="#/practice?cat=${c.id}">演習</a></td></tr>`;
          }).join("")}</tbody>
        </table></div></div>
      </div>

      <div class="section">
        <div class="section-title">模擬試験の履歴</div>
        ${exams.length ? `<div class="card"><div class="table-wrap"><table class="table">
          <thead><tr><th>日時</th><th class="num">問題数</th><th class="num">正解</th><th class="num">正答率</th><th class="num">所要時間</th></tr></thead>
          <tbody>${exams.map((x) => `<tr><td>${fmtDate(x.ts)}</td><td class="num">${x.n}</td><td class="num">${x.score}</td><td class="num ${pct(x.score, x.n) >= 70 ? "t-ok" : "t-ng"}">${pct(x.score, x.n)}%</td><td class="num">${fmtSec(x.sec)}</td></tr>`).join("")}</tbody>
        </table></div></div>` : `<div class="card empty">まだ受験記録はありません。</div>`}
      </div>

      <div class="section">
        <div class="section-title">データ管理</div>
        <div class="card">
          <div class="data-ops">
            <button class="btn" data-act="export">エクスポート</button>
            <label class="btn">インポート<input type="file" accept="application/json,.json" id="importFile" class="sr-only"></label>
            <button class="btn btn-danger" data-act="reset">記録をリセット</button>
          </div>
        </div>
      </div>`;

    onAct({
      export: () => {
        const blob = new Blob([JSON.stringify(S, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `g-kentei-study-${dayKey()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      },
      reset: () => {
        if (!confirm("すべての学習記録を削除します。よろしいですか？")) return;
        S = blank();
        save();
        render();
      },
    });
    app.onchange = (e) => {
      if (e.target.id !== "importFile" || !e.target.files[0]) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (typeof data !== "object" || !data || typeof data.q !== "object") throw new Error("invalid");
          if (!confirm("現在の記録を、読み込んだデータで置き換えます。よろしいですか？")) return;
          S = Object.assign(blank(), data);
          save();
          render();
        } catch (err) {
          alert("ファイルを読み込めませんでした。エクスポートしたJSONファイルを選択してください。");
        }
      };
      reader.readAsText(e.target.files[0]);
    };
  }

  // ───────── テーマ切り替え ─────────
  const themeBtn = document.getElementById("themeBtn");
  function currentTheme() {
    const t = document.documentElement.dataset.theme;
    if (t) return t;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function syncThemeBtn() { themeBtn.textContent = currentTheme() === "dark" ? "ライト" : "ダーク"; }
  themeBtn.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("gken-theme", next); } catch (e) { /* noop */ }
    syncThemeBtn();
  });
  syncThemeBtn();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeBtn);

  render();
})();
