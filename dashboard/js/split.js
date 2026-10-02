/* ==========================================================================
   split.js - 레이아웃 너비 / 높이 조절 (거터 드래그)
   드래그: 크기 조절 · 더블클릭: 기본값 복귀
   ========================================================================== */
(function (D) {
  'use strict';

  var KEY = 'edit-dashboard-layout-v1';

  /*
     sizeFrom : 이 거터가 조절하는 패널 (현재 크기를 여기서 읽는다)
     flexSel  : 남은 공간을 흡수하는 패널 (최소 크기를 지켜준다)
     dir      : 거터가 대상 패널의 오른쪽/아래면 +1, 왼쪽/위면 -1
  */
  var GUTTERS = [
    {
      sel: '#gAiC1', axis: 'x', grid: '.ai-grid', v: '--ai-c1', label: '스타일 패널 너비',
      sizeFrom: '#paneStyle', flexSel: '#paneLog', dir: 1, min: 240, flexMin: 260
    },
    {
      sel: '#gAiC2', axis: 'x', grid: '.ai-grid', v: '--ai-c2', label: '추가 프롬프트 너비',
      sizeFrom: '#panePrompt', flexSel: '#paneLog', dir: 1, min: 220, flexMin: 260
    },
    {
      sel: '#gFbC1', axis: 'x', grid: '.fb-grid', v: '--fb-c1', label: '왼쪽 칸 너비',
      sizeFrom: '#paneSrc', flexSel: '.fb-main', dir: 1, min: 200, flexMin: 340
    },
    {
      sel: '#gFbR1', axis: 'y', grid: '.fb-grid', v: '--fb-r1', label: '추가 소스 높이',
      sizeFrom: '#paneSrc', flexSel: '#paneNotes', dir: 1, min: 120, flexMin: 150
    },
    /* 영상과 (프롬프트+렌더링) 사이. 가로 영상이면 위아래로 갈리고,
       세로 영상이면 좌우로 갈린다 (지시) - 방향도 기억하는 값도 바뀐다.
       값을 따로 두는 까닭은, 가로에서 잡아 둔 높이가 세로의 너비로
       쓰이면 칸이 엉뚱한 크기로 서기 때문이다. */
    {
      sel: '#gFbR2', grid: '.fb-grid', label: '영상 칸',
      axis: function () { return vert() ? 'x' : 'y'; },
      v: function () { return vert() ? '--fb-sw' : '--fb-sh'; },
      dir: function () { return vert() ? 1 : -1; },
      sizeFrom: '.fb-side', flexSel: '#paneVideo', min: 150, flexMin: 200
    },
    /* 프롬프트와 렌더링 사이 거터는 뺐다 (2026-10-02: 렌더는 사용자 편집 탭의 렌더 탭으로, 편집 단추는 프롬프트 머리로) */
    /* 사용자 편집 탭 (2026-10-02 둘째: "사용자 편집도 피드백 처럼 레이아웃 사이즈 변경 가능하게").
       손잡이는 칸 사이에 떠 있는 띠 (useredit.css .ue-gut) - 남는 자리는 늘 뷰어가 받는다 */
    {
      sel: '#gUeC1', axis: 'x', grid: '.ue-grid', v: '--ue-c1', label: '소스 칸 너비',
      sizeFrom: '#view-edit .ue-pool', flexSel: '#view-edit .ue-vpane', dir: 1, min: 160, flexMin: 280
    },
    {
      sel: '#gUeC3', axis: 'x', grid: '.ue-grid', v: '--ue-c3', label: '인스펙터 너비',
      sizeFrom: '#view-edit .ue-inspector', flexSel: '#view-edit .ue-vpane', dir: -1, min: 200, flexMin: 280
    },
    {
      sel: '#gUeR', axis: 'y', grid: '.ue-grid', v: '--ue-tl-h', label: '타임라인 높이',
      sizeFrom: '#view-edit .ue-timeline', flexSel: '#view-edit .ue-vpane', dir: -1, min: 130, flexMin: 160
    }
  ];

  /* 함수로 적어 둔 자리는 그때그때 물어본다 */
  function val(x) { return typeof x === 'function' ? x() : x; }

  var saved = {};

  function load() {
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
    catch (e) { saved = {}; }
  }

  function save() {
    /* 실패해도 로그에 적지 않는다. 화면 너비는 편집 기록이 아니다. */
    try { localStorage.setItem(KEY, JSON.stringify(saved)); }
    catch (e) { /* noop */ }
  }

  function px(v) { return Math.round(v) + 'px'; }
  function sizeOf(el, axis) {
    var r = el.getBoundingClientRect();
    return axis === 'x' ? r.width : r.height;
  }

  /* 완성본의 가로세로 비. 세로 영상(쇼츠)은 그림이 좁아 영상 칸을 넓게
     둘 까닭이 없다 - 그만큼 왼쪽(자막)에 넘긴다. 지시: 영상 사이즈에 따라
     기본 자리와 크기가 달라져야 한다. */
  function aspect() {
    var c = (D.state.review && D.state.review.canvas)
      || (D.state.layout && D.state.layout.canvas);
    if (!c || !c[0] || !c[1]) return 16 / 9;
    return c[0] / c[1];
  }

  function vert() { return aspect() < 1; }

  /* 저장값이 없을 때 화면 크기에 맞춘 기본값 */
  function defaults() {
    var W = window.innerWidth, H = window.innerHeight;
    var v = vert();
    return {
      '--ai-c1': px(D.clamp(W * 0.29, 300, 560)),
      '--ai-c2': px(D.clamp(W * 0.25, 280, 460)),
      '--fb-c1': px(D.clamp(W * (v ? 0.22 : 0.24), 220, 460)),
      '--fb-r1': px(D.clamp(H * 0.42, 180, 620)),
      /* 가로 영상: 영상 아래에 붙는 프롬프트+렌더링 줄의 높이 */
      '--fb-sh': px(D.clamp(H * 0.26, 160, 320)),
      /* 가로 영상: 그 줄에서 렌더링이 차지하는 너비 */
      '--fb-rw': px(D.clamp(W * 0.17, 220, 380)),
      /* 세로 영상: 영상 왼쪽에 서는 프롬프트+렌더링 칸의 너비 */
      '--fb-sw': px(D.clamp(W * 0.24, 240, 460)),
      /* 세로 영상: 그 칸에서 렌더링이 차지하는 높이 */
      '--fb-rh': px(D.clamp(H * 0.24, 150, 300)),
      '--ue-c1': px(D.clamp(W * 0.16, 200, 360)),
      '--ue-c3': px(D.clamp(W * 0.19, 240, 420)),
      '--ue-tl-h': px(D.clamp(H * 0.34, 200, 460))
    };
  }

  function apply() {
    var def = defaults();
    Object.keys(def).forEach(function (k) {
      var v = saved[k] || def[k];
      D.$$('.ai-grid, .fb-grid, .ue-grid').forEach(function (g) { g.style.setProperty(k, v); });
    });
    D.$$('.fb-grid').forEach(function (g) { g.classList.toggle('is-vert', vert()); });
  }

  /* 창이 줄어 흡수 패널이 최소보다 작아지면 눌러준다.
     저장값 자체는 건드리지 않으므로 창이 다시 커지면 원래 크기로 돌아온다. */
  function reflow(quiet) {
    apply();
    ['ai', 'fb', 'ue'].forEach(function (which) {
      var list = GUTTERS.filter(function (g) { return g.grid.indexOf(which) !== -1; });
      ['x', 'y'].forEach(function (axis) {
        var group = list.filter(function (g) { return val(g.axis) === axis; });
        if (!group.length) return;
        var flex = D.$(group[0].flexSel);
        var grid = D.$(group[0].grid);
        if (!flex || !grid || !flex.offsetParent) return;
        var deficit = group[0].flexMin - sizeOf(flex, axis);
        if (deficit <= 1) return;
        /* 큰 쪽부터 깎는다 */
        group.slice().sort(function (a, b) {
          return sizeOf(D.$(b.sizeFrom), axis) - sizeOf(D.$(a.sizeFrom), axis);
        }).forEach(function (g) {
          if (deficit <= 1) return;
          var cur = sizeOf(D.$(g.sizeFrom), axis);
          var next = Math.max(g.min, cur - deficit);
          deficit -= (cur - next);
          grid.style.setProperty(val(g.v), px(next));
        });
      });
    });
  }

  function afterResize() {
    if (D.Feedback) D.Feedback.refresh();
  }

  function bind(g) {
    var el = D.$(g.sel);
    if (!el) return;
    var grid = D.$(g.grid);

    el.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      ev.preventDefault();
      el.setPointerCapture(ev.pointerId);
      el.classList.add('is-drag');
      document.body.classList.add('is-resizing');

      /* 방향이 바뀌는 거터가 있다 (영상 칸 · 렌더링 칸). 잡는 순간에 정한다. */
      var axis = val(g.axis), v = val(g.v), dir = val(g.dir);
      var start = axis === 'x' ? ev.clientX : ev.clientY;
      var startSize = sizeOf(D.$(g.sizeFrom), axis);
      var flexSize = sizeOf(D.$(g.flexSel), axis);
      var max = startSize + flexSize - g.flexMin;
      var frame = null, last = startSize;

      function move(e) {
        var now = axis === 'x' ? e.clientX : e.clientY;
        last = D.clamp(startSize + dir * (now - start), g.min, Math.max(g.min, max));
        grid.style.setProperty(v, px(last));
        if (frame) return;
        frame = requestAnimationFrame(function () { frame = null; afterResize(); });
      }

      function up() {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        el.classList.remove('is-drag');
        document.body.classList.remove('is-resizing');
        saved[v] = px(last);
        save();
        afterResize();
      }

      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });

    el.addEventListener('dblclick', function () {
      var v = val(g.v);
      delete saved[v];
      grid.style.setProperty(v, defaults()[v]);
      save();
      afterResize();
    });
  }

  D.Split = {
    init: function () {
      load();
      apply();
      GUTTERS.forEach(bind);
      reflow(true);
      window.addEventListener('resize', function () { reflow(true); });
    },
    reset: function () {
      saved = {};
      save();
      apply();
      afterResize();
    },
    reflow: reflow
  };

})(window.D);
