/* ==========================================================================
   useredit.js - 사용자 편집 탭 (2026-10-02)

   사용자: "피드백 탭 옆에 사용자 편집 탭을 추가하고 거기에 편집 프로그램 같은 ui 를 만들어줘 ui 스타일은 다빈치 리졸브처럼",
   "컷 직접 조작부터". 카덴라이브는 "ui 나 컨트롤이 어려운데" 로 버렸다.

   클립 = 원본 한 토막 [원본 시작 s, 원본 끝 e] 을 편집 시각 at 에 놓은 것. 목록은 review.userClips 로 저장되고
   렌더 단추 (tools/apply_review.py) 가 그대로 남길 구간으로 굽는다 - 자막 · 연출 시각은 원본 시각을 거쳐 따라 옮긴다.
   처음 열 때는 지금 컷 (피드백 탭의 낱말 되살리기 · 빼기까지 든 계획) 에서 시작한다.
   미리보기는 피드백 탭과 같은 굽지 않은 미리보기 (원본 사본에서 남길 구간을 이어 튼다, D.Feedback.sceneFor).

   타임라인 규칙 (timeline-playhead-nle-rules): 재생 위치 선은 클립을 고치거나 골라도 화면에서 제자리 ·
   클립을 누르는 것은 고르기일 뿐 (시점 안 옮김) · 눈금은 시간에 정비례 · 끌기는 마우스 1px = 눈금 1px.
   ========================================================================== */
(function (D) {
  'use strict';

  var R = null;            // review (피드백 탭과 같은 객체)
  var CL = [];             // 클립 [{id, s, e, at}] - at 순서
  var SEL = {};            // 고른 클립 id
  var CSEL = null;         // 고른 자막 줄 (장면 자막 id - 'r<번호>' 가 review.captions[번호])
  var PANE = 'ins';        // 오른쪽 탭: ins | words | render
  var TOOL = 'select';     // select | blade
  var SNAP = true, RIP = true;
  var PPS = 80;            // 1초 = px
  var FPS = 60;
  var SHOWN = false, SC = null, MOUNTING = false;
  var UNDO = [], REDO = [];
  var UID = 1, drag = null, rafId = 0, upd = 0, MINW = 0;
  var MIN = 2;             // 클립 최소 길이 (프레임)
  var EDGEPX = 7;          // 끝 잡기 폭 (px)
  var SNAPPX = 8;          // 붙기 거리 (px)

  /* ---------- 시각 ---------- */
  function fr(t) { return Math.round(t * FPS) / FPS; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tc(t) {                         // 리졸브 식 00:00:12:34
    t = Math.max(0, t || 0);
    var f = Math.round(t * FPS), s = Math.floor(f / FPS);
    return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) + ':' + pad(f % FPS);
  }
  function stc(t) {                        // 원본 시각 짧게 1:23.45
    t = Math.max(0, t || 0);
    var m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  }
  function len(c) { return c.e - c.s; }
  function end(c) { return c.at + len(c); }
  function total() { return CL.reduce(function (a, c) { return Math.max(a, end(c)); }, 0); }
  function sorted() { return CL.slice().sort(function (a, b) { return a.at - b.at; }); }
  function plan() {
    var P = sorted().map(function (c) { return [c.s, c.e, c.at]; });
    P.ripple = true;
    return P;
  }
  function srcDur() {
    var w = waveData();
    if (w && w.b64) return Math.floor(w.b64.length * 3 / 4) / (w.hz || 50);
    return Infinity;
  }
  function byId(id) { for (var i = 0; i < CL.length; i++) if (CL[i].id === id) return CL[i]; return null; }
  function selected() { return CL.filter(function (c) { return SEL[c.id]; }); }
  function pack() {                        // 리플: 순서대로 틈 없이
    var t = 0;
    sorted().forEach(function (c) { c.at = fr(t); t = c.at + len(c); });
  }
  function clipAt(t) {
    var r = null;
    CL.forEach(function (c) { if (t >= c.at - 1e-6 && t < end(c) - 1e-6) r = c; });
    return r;
  }
  function edits() {                       // 편집 점 (클립 시작 · 끝)
    var a = [0];
    CL.forEach(function (c) { a.push(c.at, end(c)); });
    return a.sort(function (x, y) { return x - y; }).filter(function (x, i, A) { return i === 0 || x - A[i - 1] > 1e-4; });
  }

  /* ---------- 되돌리기 ---------- */
  function snapshot() { return JSON.stringify({ c: CL, k: R ? R.captions : null }); }
  function remember() { UNDO.push(snapshot()); if (UNDO.length > 200) UNDO.shift(); REDO = []; }
  function restoreState(js) { var o = JSON.parse(js); CL = o.c; if (R && o.k) R.captions = o.k; SEL = {}; changed(); }
  function undo() { if (!UNDO.length) return; REDO.push(snapshot()); restoreState(UNDO.pop()); D.toast('되돌림'); }
  function redo() { if (!REDO.length) return; UNDO.push(snapshot()); restoreState(REDO.pop()); D.toast('다시 함'); }

  /* 고친 뒤: 저장 · 미리보기 · 다시 그리기 */
  function changed() {
    if (R) {
      R.userClips = sorted().map(function (c) { return { s: +c.s.toFixed(4), e: +c.e.toFixed(4), at: +c.at.toFixed(4) }; });
      D.touch();
    }
    draw();
    clearTimeout(upd);
    upd = setTimeout(refreshScene, 120);
  }

  /* ---------- 미리보기 ----------
     피드백 탭과 **같은 영상**을 쓴다 (사용자 2026-10-02 둘째: "피드백 탭과 사용자 편집 탭의 영상은 공유",
     "피드백에서 미리보기 변경 사항도 사용자 편집에서 적용"). 피드백 탭의 화면 (.fb-stage-wrap - 영상 · 쪽지 · 화살표가 든 상자)
     을 이 탭이 보일 때 뷰어로 옮겨 오고, 떠날 때 돌려놓는다. 그래서 재생 위치 · 장면 (자막 고침 · 클립) · 쪽지가 두 탭에서 같다.
     영상 시각 = 이 타임라인 시각 (클립을 고치면 review.userClips 가 피드백 탭의 계획이 된다). */
  var BOUND = null;
  function video() { var v = D.Feedback && D.Feedback.video(); return v && (v.src || v.duration || SC) ? v : null; }
  function now() { var v = video(); return v ? v.currentTime || 0 : (drag && drag.t != null ? drag.t : 0); }
  function viewerMsg(msg) {
    var host = D.$('#ueViewer');
    var m = host.querySelector('.ue-msg');
    if (!msg) { if (m) m.remove(); return; }
    if (!m) { m = D.el('div', { class: 'ue-msg' }); host.appendChild(m); }
    m.textContent = msg;
  }
  function bindShared() {                  // 피드백 탭이 프로젝트를 새로 열면 영상 객체가 바뀐다 - 바뀔 때마다 다시 단다
    var v = D.Feedback && D.Feedback.video();
    if (!v || v === BOUND) return;
    BOUND = v;
    v.addEventListener('play', function () { if (BOUND !== v) return; icon('pause'); loop(); });
    v.addEventListener('pause', function () { if (BOUND !== v) return; icon('play'); drawPlayhead(); });
    v.addEventListener('seeked', function () { if (BOUND === v && SHOWN) drawPlayhead(); });
    v.addEventListener('timeupdate', function () { if (BOUND === v && SHOWN && v.paused) drawPlayhead(); });
    v.addEventListener('loadedmetadata', function () { if (BOUND === v && SHOWN) { fitViewer(); drawPlayhead(); } });
    icon(v.paused ? 'play' : 'pause');
  }
  function mountPlayer() {                 // 피드백 화면을 뷰어로 옮겨 온다
    if (MOUNTING || !R || !SHOWN) return;
    var wrap = D.$('.fb-stage-wrap');
    if (wrap && wrap.parentNode !== D.$('#ueViewer')) D.$('#ueViewer').appendChild(wrap);
    if (!D.Feedback.ready()) {
      if (!R.srcPreview && R.scene) viewerMsg('원본 사본이 없어 컷을 고친 미리보기를 못 합니다 - 내보내기를 다시 해 주세요 (tools/src_preview.py)');
      MOUNTING = true;
      setTimeout(function () { MOUNTING = false; if (SHOWN) mountPlayer(); }, 400);
      return;
    }
    viewerMsg('');
    SC = D.Feedback.sceneFor(plan());
    if (SC) FPS = SC.fps || 60;
    bindShared();
    fitViewer();
    draw();
  }
  function unmountPlayer() {               // 피드백 탭 제자리 (전송 막대 앞) 로 돌려놓는다
    var wrap = D.$('.fb-stage-wrap'), body = D.$('#paneVideo .video-body');
    if (wrap && body && wrap.parentNode !== body) body.insertBefore(wrap, body.querySelector('.fb-transport'));
    if (D.Feedback && D.Feedback.refresh) D.Feedback.refresh();
  }
  function refreshScene() {
    if (!R || !D.Feedback.ready()) return;
    var t = now();
    SC = D.Feedback.sceneFor(plan());
    if (!SC) return;
    D.Feedback.livePreview(Math.min(t, Math.max(0, total() - 1 / FPS)));   // 같은 영상에 새 장면 - 고쳐도 보던 시각을 지킨다
    bindShared();
    tag();
    draw();
  }
  function fitViewer() { if (SHOWN && D.Feedback && D.Feedback.refresh) D.Feedback.refresh(); tag(); }
  function tag() {                         // 렌더 전 (완성본이 옛것 · 고친 컷이 있다) 이면 뷰어 머리에 표
    var t = D.$('#ueTag');
    if (t) t.hidden = !(D.Feedback && D.Feedback.sceneNow && (D.Feedback.sceneNow() || {}).plan);
  }
  function icon(name) { var u = D.$('#uePlay use'); if (u) u.setAttribute('href', '#i-' + name); }
  function toggle() { var v = video(); if (!v) return; if (v.paused) { if (v.currentTime >= total() - 0.02) v.currentTime = 0; v.play(); } else v.pause(); }
  function seek(t) {
    t = Math.max(0, Math.min(fr(t), Math.max(0, total() - 1 / FPS)));
    var v = video();
    if (v) v.currentTime = t; else if (drag) drag.t = t;
    drawPlayhead();
  }
  function loop() {
    cancelAnimationFrame(rafId);
    var v = video();
    if (!v || v.paused) return;
    drawPlayhead(true);
    rafId = requestAnimationFrame(loop);
  }

  /* ---------- 타임라인 그리기 ---------- */
  function scroller() { return D.$('#ueScroll'); }
  function X(t) { return t * PPS; }
  function T(x) { return x / PPS; }
  function draw() {
    var sc = scroller();
    if (!sc) return;
    var cont = D.$('#ueContent');
    var w = Math.max(MINW, X(total() + 20), sc.clientWidth);
    MINW = w;                               // 편집 중에는 줄이지 않는다 - 줄면 스크롤이 당겨져 선이 화면에서 움직인다
    cont.style.width = w + 'px';
    drawRuler(w);
    drawCaps();
    var LH = laneHeights();
    var lv = D.$('#ueLaneV'), la = D.$('#ueLaneA');
    lv.textContent = ''; la.textContent = '';
    sorted().forEach(function (c, i) {
      [['v', lv], ['a', la]].forEach(function (kv) {
        var el = D.el('div', { class: 'ue-clip ue-' + kv[0] + (SEL[c.id] ? ' is-sel' : '') });
        el.style.left = X(c.at) + 'px';
        el.style.width = Math.max(2, X(len(c))) + 'px';
        el.dataset.id = c.id;
        if (kv[0] === 'v') {
          film(el, c, LH - 6 - 16);
          el.appendChild(D.el('span', { class: 'ue-clip-name', text: (i + 1) + '  ' + stc(c.s) + ' - ' + stc(c.e) }));
        } else {
          wave(el, c, LH - 8);
        }
        el.appendChild(D.el('i', { class: 'ue-trim ue-trim-l' }));
        el.appendChild(D.el('i', { class: 'ue-trim ue-trim-r' }));
        kv[1].appendChild(el);
      });
    });
    drawPlayhead();
    side();
    drawWords();
  }
  /* V1 · A1 높이는 고정 (사용자 2026-10-02: "클립 높이가 너무 긴데 줄여줘" - 타임라인 칸을 나눠 갖게 했더니 클립이 길쭉해졌다).
     타임라인 칸을 키우면 아래가 빈다 (리졸브도 트랙 높이는 칸 크기와 따로) */
  var LANE_H = 50;
  function laneHeights() {
    var h = LANE_H;
    ['#ueLaneV', '#ueLaneA', '#view-edit .ue-hd-v', '#view-edit .ue-hd-a'].forEach(function (q) {
      var e = D.$(q); if (e) { e.style.height = h + 'px'; e.style.flexBasis = h + 'px'; }
    });
    return h;
  }
  function drawRuler(w) {
    var ru = D.$('#ueRuler');
    ru.textContent = '';
    var steps = [1 / FPS * 5, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300], step = 300;
    for (var i = 0; i < steps.length; i++) if (X(steps[i]) >= 90) { step = steps[i]; break; }
    var minor = step / 5;
    for (var t = 0; X(t) <= w; t += minor) {
      var major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      var tk = D.el('i', { class: 'ue-tick' + (major ? ' is-major' : '') });
      tk.style.left = X(t) + 'px';
      ru.appendChild(tk);
      if (major) {
        var lb = D.el('span', { class: 'ue-tlabel', text: tc(t) });
        lb.style.left = (X(t) + 3) + 'px';
        ru.appendChild(lb);
      }
    }
  }
  /* ---------- 썸네일 · 파형 (2026-10-02 둘째: "오디오 부분에 파형 적용 비디오의 경우 일정부분마다 썸네일 캡쳐해서 클립에 적용") ----------
     서버가 원본 사본 (review.srcPreview) 에서 0.5초마다 한 장씩 뜬 격자 그림 하나 (/api/media/thumbs) 와
     파형 (review.wave 가 없는 옛 편은 /api/media/wave) 을 만들어 준다. 한 번 만들면 서버 임시 폴더에 남는다. */
  var TH = null, TIMG = null, WAVE = null, MEDIA_FOR = null;
  function loadMedia() {
    var p = R && R.srcPreview && R.srcPreview.path;
    if (!p || MEDIA_FOR === p) return;
    MEDIA_FOR = p; TH = null; WAVE = null;
    var q = '?path=' + encodeURIComponent(p);
    fetch('/api/media/thumbs' + q).then(function (r) { return r.json(); }).then(function (j) {
      if (MEDIA_FOR !== p || !j.ok || j.none) return;
      var im = new Image();
      im.onload = function () { if (MEDIA_FOR !== p) return; TH = j; TIMG = im; draw(); };
      im.src = j.url;
    }).catch(function (e) { D.warn('썸네일을 못 만들었습니다: ' + e.message, 'useredit'); });
    if (!(R.wave && R.wave.b64)) {
      fetch('/api/media/wave' + q).then(function (r) { return r.json(); }).then(function (j) {
        if (MEDIA_FOR !== p || !j.ok) return;
        WAVE = j; draw();
      }).catch(function (e) { D.warn('파형을 못 만들었습니다: ' + e.message, 'useredit'); });
    }
  }
  function film(el, c, h) {                // 클립 머리 아래로 썸네일을 줄지어 (칸마다 그 자리 원본 시각의 그림)
    if (!TH || h < 12) return;
    var tw = h * TH.tw / TH.th, W = X(len(c)), rows = Math.ceil(TH.n / TH.cols);
    var box = D.el('div', { class: 'ue-film' });
    box.style.height = h + 'px';
    var size = (TH.cols * tw) + 'px ' + (rows * h) + 'px';
    for (var x = 0; x < W && x < 60000; x += tw) {
      var k = Math.max(0, Math.min(TH.n - 1, Math.round((c.s + T(x)) / TH.step)));
      var f = D.el('i');
      f.style.left = x + 'px'; f.style.width = Math.ceil(tw) + 'px';
      f.style.backgroundImage = 'url("' + TH.url + '")';
      f.style.backgroundSize = size;
      f.style.backgroundPosition = (-(k % TH.cols) * tw) + 'px ' + (-Math.floor(k / TH.cols) * h) + 'px';
      box.appendChild(f);
    }
    el.appendChild(box);
  }
  /* ---------- 소스 (2026-10-02 둘째: "미디어 · 클립 부분 -> 소스 폴더 추가로 변경") ----------
     왼쪽 칸 = 리졸브의 미디어 풀처럼 폴더째 넣는 소스 목록. 첫 묶음은 이 편 원본 (사본), 그 아래 사용자가 넣은 폴더들.
     폴더 경로는 review.srcFolders 로 저장되고 (server.py 저장 칸), 편집 (AI) 단추가 넘기는 글에도 들어간다.
     브라우저는 고른 폴더의 진짜 경로를 안 주므로 서버가 폴더를 읽어 고르는 창을 띄운다 (/api/media/browse · list). */
  var BINS = {}, OPEN = {}, FSEL = null;
  function folders() { return (R && R.srcFolders) || []; }
  function drawBins() {
    var host = D.$('#ueBins');
    if (!host) return;
    host.textContent = '';
    if (!R) { host.appendChild(D.el('div', { class: 'ue-ins-empty', text: '프로젝트를 열면 여기에' })); return; }
    var own = R.srcPreview && R.srcPreview.path;
    var groups = [];
    if (own) groups.push({ key: '', name: '이 편 원본', files: [{ name: String(own).split(/[\\/]/).pop(), path: own, kind: 'video' }], fixed: true });
    folders().forEach(function (f) {
      groups.push({ key: f, name: f.split(/[\\/]/).filter(Boolean).pop() || f, files: BINS[f], title: f });
    });
    groups.forEach(function (g) {
      var open = OPEN[g.key] !== false;
      var hd = D.el('div', { class: 'ue-bin' + (open ? ' is-open' : ''), title: g.title || '' });
      hd.appendChild(D.icon('folder'));
      hd.appendChild(D.el('span', { class: 'ue-bin-n', text: g.name }));
      hd.appendChild(D.el('span', { class: 'ue-bin-c', text: g.files ? g.files.length + '' : '...' }));
      if (!g.fixed) {
        var rm = D.el('button', { class: 'ue-bin-x', title: '소스 폴더 빼기 (파일은 안 지운다)' });
        rm.appendChild(D.icon('x'));
        rm.addEventListener('click', function (ev) {
          ev.stopPropagation();
          R.srcFolders = folders().filter(function (x) { return x !== g.key; });
          D.touch(); drawBins();
        });
        hd.appendChild(rm);
      }
      hd.addEventListener('click', function () { OPEN[g.key] = !open; drawBins(); });
      host.appendChild(hd);
      if (!open) return;
      if (!g.files) { loadBin(g.key); return; }
      if (!g.files.length) host.appendChild(D.el('div', { class: 'ue-ins-empty ue-bin-empty', text: '영상 · 소리 · 그림이 없습니다' }));
      g.files.forEach(function (f) {
        var row = D.el('div', { class: 'ue-media' + (FSEL === f.path ? ' is-sel' : ''), title: f.path });
        var th = D.el('div', { class: 'ue-media-th is-' + f.kind });
        if (f.kind !== 'audio') {
          var im = D.el('img', { loading: 'lazy', alt: '', src: '/api/media/poster?path=' + encodeURIComponent(f.path) });
          im.addEventListener('error', function () { im.remove(); th.appendChild(D.icon('video')); });
          th.appendChild(im);
        } else th.appendChild(D.icon('vol'));
        row.appendChild(th);
        var tx = D.el('div', { class: 'ue-media-t' });
        tx.appendChild(D.el('b', { text: f.name }));
        tx.appendChild(D.el('small', { text: (f.kind === 'video' ? '영상' : f.kind === 'audio' ? '소리' : '그림') + (f.size ? ' · ' + D.fmtBytes(f.size) : '') }));
        row.appendChild(tx);
        row.addEventListener('click', function () { FSEL = f.path; drawBins(); });
        host.appendChild(row);
      });
    });
  }
  function loadBin(dir) {
    if (BINS[dir] === null) return;
    BINS[dir] = null;
    fetch('/api/media/list?path=' + encodeURIComponent(dir)).then(function (r) { return r.json(); }).then(function (j) {
      BINS[dir] = j.ok ? j.files : [];
      if (!j.ok) D.warn('소스 폴더를 못 읽었습니다: ' + (j.error || dir), 'useredit');
      drawBins();
    }).catch(function () { BINS[dir] = []; drawBins(); });
  }
  function addFolder() {                   // 서버가 읽은 폴더를 오가며 고른다
    if (!R) { D.toast('프로젝트를 먼저 여세요'); return; }
    var body = D.el('div', { class: 'ue-browse' });
    var where = D.el('div', { class: 'ue-browse-path' });
    var list = D.el('div', { class: 'ue-browse-list' });
    body.appendChild(where); body.appendChild(list);
    var cur = '';
    var go = function (p) {
      fetch('/api/media/browse?path=' + encodeURIComponent(p || '')).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok) { D.toast(j.error || '폴더를 못 읽었습니다'); return; }
        cur = j.path; where.textContent = j.path || '내 PC';
        list.textContent = '';
        if (j.parent != null) list.appendChild(row('..', 'folder', function () { go(j.parent); }));
        j.dirs.forEach(function (d) { list.appendChild(row(d.name, 'folder', function () { go(d.path); })); });
        j.files.forEach(function (f) {
          var r = row(f.name, f.kind === 'audio' ? 'vol' : 'video', null);
          r.classList.add('is-file');
          r.appendChild(D.el('small', { text: D.fmtBytes(f.size) }));
          list.appendChild(r);
        });
      });
    };
    var row = function (name, ic, fn) {
      var r = D.el('div', { class: 'ue-browse-row' });
      r.appendChild(D.icon(ic));
      r.appendChild(D.el('span', { text: name }));
      if (fn) r.addEventListener('click', fn);
      return r;
    };
    var start = folders()[folders().length - 1];
    if (!start && R.srcPreview && R.srcPreview.path) start = String(R.srcPreview.path).replace(/[\\/][^\\/]*$/, '');
    go(start || '');
    D.modal.open({
      title: '소스 폴더 추가', body: body,
      buttons: [{ label: '취소' }, {
        label: '이 폴더 추가', class: 'btn-primary', onClick: function () {
          if (!cur) { D.toast('폴더를 고르세요'); return false; }
          if (folders().indexOf(cur) === -1) { R.srcFolders = folders().concat([cur]); D.touch(); }
          OPEN[cur] = true; delete BINS[cur]; drawBins();
          D.info('소스 폴더 추가: ' + cur, 'useredit');
        }
      }]
    });
  }
  var WB = null, WSRC = '', WLO = 0, WHI = 255;
  function waveData() { return R && R.wave && R.wave.b64 ? R.wave : WAVE; }
  function waveBytes() {
    var w = waveData();
    if (!w || !w.b64) return null;
    if (WSRC !== w.b64) {
      var bin = atob(w.b64), a = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      WB = a; WSRC = w.b64;
      var srt = Array.prototype.slice.call(a).sort(function (x, y) { return x - y; });
      WLO = srt[Math.floor(srt.length * 0.10)] || 0; WHI = Math.max(WLO + 1, srt[Math.floor(srt.length * 0.995)] || 255);
    }
    return WB;
  }
  function wave(el, c, H) {                // 원본 소리 파형 (피드백 탭과 같은 눈금 - 바닥 잡음 10% 가 0). 칸 높이를 다 쓴다
    var B = waveBytes();
    if (!B) return;
    var hz = waveData().hz || 50, dpr = window.devicePixelRatio || 1;
    var CW = Math.max(2, Math.round(X(len(c)))), W = Math.min(4000, CW);
    H = Math.max(20, H || 40);
    var cv = document.createElement('canvas');
    cv.className = 'ue-wave';
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = CW + 'px'; cv.style.height = H + 'px';   // 4000px 넘는 클립은 늘여 그린다 (예전엔 잘렸다)
    var g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = 'rgba(190,240,205,.75)';
    for (var x = 0; x < W; x++) {
      var s0 = c.s + len(c) * x / W, s1 = c.s + len(c) * (x + 1) / W, best = -1;
      for (var j = Math.floor(s0 * hz); j < Math.max(Math.floor(s0 * hz) + 1, Math.ceil(s1 * hz)) && j < B.length; j++) if (B[j] > best) best = B[j];
      if (best < 0) continue;
      var v = Math.max(0, Math.min(1, (best - WLO) / (WHI - WLO))), hh = (H / 2 - 2) * v;
      if (hh >= 0.5) g.fillRect(x, H / 2 - hh, 1, hh * 2);
    }
    el.appendChild(cv);
  }
  function drawCaps() {                    // 자막 줄 - 지금은 보기만 (고치기는 피드백 탭)
    var ls = D.$('#ueLaneS');
    if (!ls) return;
    ls.textContent = '';
    /* 겹치는 줄 (설명 딱지 · 자막) 은 줄을 나눠 쌓는다 - 한 줄에 두면 앞 것이 뒤 것을 가려 고를 수가 없었다 */
    var rows = [], caps = ((SC && SC.captions) || []).filter(function (c) { return c.e > c.s; }).slice().sort(function (a, b) { return a.s - b.s; });
    var rowOf = caps.map(function (c) {
      for (var r = 0; r < rows.length; r++) if (rows[r] <= c.s + 1e-3) { rows[r] = c.e; return r; }
      rows.push(c.e); return rows.length - 1;
    });
    var RH = 22, H = Math.max(34, rows.length * RH + 6);
    ls.style.height = H + 'px';
    var hd = D.$('#view-edit .ue-hd-s'); if (hd) { hd.style.height = H + 'px'; hd.style.flexBasis = H + 'px'; }
    caps.forEach(function (c, ci) {
      var el = D.el('div', { class: 'ue-cap' + (CSEL === c.id ? ' is-sel' : ''), title: c.text });
      el.dataset.cid = c.id;
      el.style.top = (3 + rowOf[ci] * RH) + 'px';
      el.style.height = (RH - 3) + 'px';
      el.style.left = X(c.s) + 'px';
      el.style.width = Math.max(2, X(c.e - c.s)) + 'px';
      el.appendChild(D.el('span', { text: String(c.text || '').split('«').join('').split('»').join('') }));
      ls.appendChild(el);
    });
  }
  function drawPlayhead(follow) {
    var ph = D.$('#uePh'), sc = scroller();
    if (!ph || !sc) return;
    var t = now(), x = X(t);
    ph.style.left = x + 'px';
    D.$('#ueTc').textContent = tc(t);
    D.$('#ueDur').textContent = tc(total());
    if (follow && (x > sc.scrollLeft + sc.clientWidth - 40 || x < sc.scrollLeft)) sc.scrollLeft = Math.max(0, x - 40);
  }

  /* ---------- 옆 칸: 클립 정보 (클립 목록은 소스 칸으로 바꿨다 - 2026-10-02 둘째) ---------- */
  function side() {
    var ins = D.$('#ueIns');
    if (!ins) return;
    ins.textContent = '';
    if (CSEL && capInspector(ins)) return;
    var S = selected();
    if (S.length !== 1) {
      ins.appendChild(D.el('div', { class: 'ue-ins-empty', text: S.length ? S.length + '개 고름' : '클립을 고르면 여기에' }));
      return;
    }
    var c = S[0];
    var field = function (label, val, set) {
      var row = D.el('label', { class: 'ue-field' });
      row.appendChild(D.el('span', { text: label }));
      var inp = D.el('input', { type: 'text', value: val });
      if (!set) inp.readOnly = true;
      else inp.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter') return;
        var v = parseT(inp.value);
        if (v == null) { D.toast('시각을 못 읽었습니다 (예: 1:23.45 또는 83.45)'); return; }
        set(v); inp.blur();
      });
      row.appendChild(inp);
      ins.appendChild(row);
    };
    ins.appendChild(D.el('div', { class: 'ue-ins-h', text: '클립 ' + (sorted().indexOf(c) + 1) }));
    field('원본 시작', stc(c.s), function (v) { trimTo(c, 'l', v); });
    field('원본 끝', stc(c.e), function (v) { trimTo(c, 'r', v); });
    field('길이', len(c).toFixed(2) + 's');
    field('타임라인', tc(c.at));
  }
  function parseT(s) {
    s = String(s || '').trim();
    if (!s) return null;
    var parts = s.split(':'), t = 0;
    for (var i = 0; i < parts.length; i++) { var n = parseFloat(parts[i]); if (isNaN(n)) return null; t = t * 60 + n; }
    return t;
  }

  /* ---------- 고르기 ---------- */
  function pick(id, add) {
    CSEL = null;
    if (!add) SEL = {};
    if (id != null) { if (add && SEL[id]) delete SEL[id]; else SEL[id] = true; }
    draw();
  }

  /* ---------- 편집 ---------- */
  function trimTo(c, side_, v) {           // 칸에 적은 원본 시각으로 끝을 옮긴다 (끌기와 같은 규칙)
    remember();
    var o = { s: c.s, e: c.e, at: c.at };
    applyTrim(c, o, side_, side_ === 'l' ? v - o.s : v - o.e);
    changed();
  }
  function neighbors(c) {
    var S = sorted(), i = S.indexOf(c);
    return { prev: S[i - 1] || null, next: S[i + 1] || null };
  }
  function applyTrim(c, o, side_, dt) {
    var m = MIN / FPS, nb = neighbors(c);
    if (side_ === 'r') {
      var e = Math.min(Math.max(o.e + dt, o.s + m), srcDur());
      if (!RIP && nb.next) e = Math.min(e, o.s + (nb.next.at - o.at));
      c.e = fr(e);
    } else {
      var s = Math.max(0, Math.min(o.s + dt, o.e - m));
      if (!RIP) {
        var lo = nb.prev ? end(nb.prev) : 0;
        s = Math.max(s, o.s - (o.at - lo));
        c.at = fr(o.at + (s - o.s));
      }
      c.s = fr(s);
    }
    if (RIP) pack();
  }
  function split(c, t) {                   // 편집 시각 t 에서 둘로
    t = fr(t);
    if (!c || t <= c.at + MIN / FPS || t >= end(c) - MIN / FPS) return false;
    var cut = c.s + (t - c.at);
    var c2 = { id: UID++, s: cut, e: c.e, at: t };
    c.e = cut;
    CL.push(c2);
    return true;
  }
  function splitAtPlayhead() {
    var t = now(), c = clipAt(t);
    remember();
    if (split(c, t)) changed(); else { UNDO.pop(); D.toast('재생 위치에 자를 클립이 없습니다'); }
  }
  function removeSel() {
    var S = selected();
    if (!S.length) return;
    if (S.length === CL.length) { D.toast('클립을 전부 지울 수는 없습니다'); return; }
    remember();
    CL = CL.filter(function (c) { return !SEL[c.id]; });
    SEL = {};
    if (RIP) pack();
    changed();
  }
  function snapT(t, skip) {               // 재생 위치 · 다른 클립 끝에 붙기
    if (!SNAP) return t;
    var best = t, bd = SNAPPX / PPS;
    var cand = [now()];
    CL.forEach(function (c) { if (c.id !== skip) cand.push(c.at, end(c)); });
    cand.forEach(function (x) { var d = Math.abs(x - t); if (d < bd) { bd = d; best = x; } });
    return best;
  }

  /* ---------- 마우스 ---------- */
  function cx(ev) { var sc = scroller(), r = sc.getBoundingClientRect(); return ev.clientX - r.left + sc.scrollLeft; }
  function onDown(ev) {
    if (ev.button !== 0) return;
    var t = T(cx(ev));
    if (ev.target.closest('#ueRuler') || ev.target.closest('#uePh')) {   // 시점은 눈금 · 선을 끌 때만 옮긴다
      drag = { kind: 'ph' };
      seek(t);
      return ev.preventDefault();
    }
    var cap = ev.target.closest('.ue-cap');
    if (cap) { CSEL = cap.dataset.cid; SEL = {}; showPane('ins'); draw(); return ev.preventDefault(); }   // 고르기만 (시점 안 옮김)
    var el = ev.target.closest('.ue-clip');
    if (!el) { if (!ev.shiftKey) pick(null); return; }
    var c = byId(+el.dataset.id);
    if (!c) return;
    if (TOOL === 'blade') {
      remember();
      if (split(c, snapT(t, null))) changed(); else UNDO.pop();
      return ev.preventDefault();
    }
    var r = el.getBoundingClientRect(), off = ev.clientX - r.left;
    var kind = off < EDGEPX ? 'l' : off > r.width - EDGEPX ? 'r' : 'move';
    CSEL = null;
    if (!SEL[c.id] || kind !== 'move') { if (!ev.shiftKey) SEL = {}; SEL[c.id] = true; }
    drag = { kind: kind, id: c.id, x0: cx(ev), base: snapshot(), o: { s: c.s, e: c.e, at: c.at }, moved: false };
    draw();
    ev.preventDefault();
  }
  function onMove(ev) {
    if (!drag) { hover(ev); return; }
    if (drag.kind === 'ph') { seek(T(cx(ev))); return; }
    var dx = cx(ev) - drag.x0;
    if (!drag.moved && Math.abs(dx) < 3) return;
    drag.moved = true;
    var dt = T(dx), o = drag.o;
    CL = JSON.parse(drag.base).c;
    var c = byId(drag.id);
    D.$('#ueSnap').hidden = true;
    if (drag.kind === 'r') {
      var e0 = o.at + (o.e - o.s), e1 = snapT(e0 + dt, c.id);
      applyTrim(c, o, 'r', e1 - e0);
      showSnap(e1 !== e0 + dt ? end(c) : null);
    } else if (drag.kind === 'l') {
      if (!RIP) { var a1 = snapT(o.at + dt, c.id); dt = a1 - o.at; showSnap(a1 !== o.at + T(dx) ? a1 : null); }
      applyTrim(c, o, 'l', dt);
    } else {
      var a = Math.max(0, o.at + dt), sa = snapT(a, c.id), se = snapT(a + (o.e - o.s), c.id) - (o.e - o.s);
      a = Math.abs(sa - a) <= Math.abs(se - a) ? sa : se;
      drag.at = fr(a);
      showSnap(a !== Math.max(0, o.at + dt) ? (a === sa ? a : a + (o.e - o.s)) : null);
    }
    draw();
    if (drag.kind === 'move') ghost(drag.id, drag.at);
  }
  function onUp() {
    if (!drag) return;
    var d = drag; drag = null;
    D.$('#ueSnap').hidden = true;
    if (d.kind === 'ph' || !d.moved) { draw(); return; }
    var after = null;
    if (d.kind === 'move') {
      CL = JSON.parse(d.base).c;
      var c = byId(d.id);
      if (RIP) {                           // 끼워 넣기: 옮긴 자리 가운데로 순서를 다시 매기고 틈 없이
        /* 옮기는 클립은 놓은 시작점, 다른 클립은 가운데로 줄 세운다 - 둘 다 가운데로 재니 맨 앞에 놓아도 첫 클립 뒤로 갔다 */
        var mid = function (x) { return x === c ? d.at + 1e-3 : x.at + len(x) / 2; };
        var ord = CL.slice().sort(function (p, q) { return mid(p) - mid(q); }), t = 0;
        ord.forEach(function (x) { x.at = fr(t); t = x.at + len(x); });
      } else {                             // 빈 자리에만 놓는다 - 겹치면 되돌림
        var hit = CL.some(function (x) { return x !== c && d.at < end(x) - 1e-6 && d.at + len(c) > x.at + 1e-6; });
        if (hit) { D.toast('다른 클립과 겹칩니다 - 리플을 켜면 끼워 넣습니다'); draw(); return; }
        c.at = d.at;
      }
    }
    after = JSON.stringify(CL);
    CL = JSON.parse(d.base).c; remember(); CL = JSON.parse(after);
    changed();
  }
  function ghost(id, at) {                // 옮기는 클립 그림자
    D.$$('.ue-clip[data-id="' + id + '"]').forEach(function (el) { el.classList.add('is-ghost'); el.style.left = X(at) + 'px'; });
  }
  function showSnap(t) {
    var s = D.$('#ueSnap');
    if (t == null) { s.hidden = true; return; }
    s.hidden = false; s.style.left = X(t) + 'px';
  }
  function hover(ev) {
    var el = ev.target.closest && ev.target.closest('.ue-clip'), cur = '';
    if (TOOL === 'blade' && el) cur = 'crosshair';
    else if (el) {
      var r = el.getBoundingClientRect(), off = ev.clientX - r.left;
      cur = off < EDGEPX || off > r.width - EDGEPX ? 'ew-resize' : 'grab';
    }
    D.$('#ueContent').style.cursor = cur;
  }
  function zoomBy(f, atX) {               // atX: 화면 x (scroller 안) - 그 자리 시각이 그대로 남게
    var sc = scroller(), x = atX == null ? sc.clientWidth / 2 : atX, t = T(sc.scrollLeft + x);
    PPS = Math.max(4, Math.min(1200, PPS * f));
    MINW = 0; draw();
    sc.scrollLeft = Math.max(0, X(t) - x);
    var z = D.$('#ueZoom'); if (z) z.value = Math.log(PPS);
  }
  function fit() {
    var sc = scroller();
    PPS = Math.max(4, (sc.clientWidth - 40) / Math.max(1, total()));
    MINW = 0; draw(); sc.scrollLeft = 0;
    var z = D.$('#ueZoom'); if (z) z.value = Math.log(PPS);
  }

  /* ---------- 오른쪽 탭 (인스펙터 · 전사 자막 · 렌더) ---------- */
  function showPane(p) {
    PANE = p;
    D.$$('#view-edit .ue-tab').forEach(function (b) { b.classList.toggle('is-on', b.dataset.pane === p); });
    D.$$('#view-edit .ue-inspector [data-pane]').forEach(function (el) { if (!el.classList.contains('ue-tab')) el.hidden = el.dataset.pane !== p; });
    if (p === 'words') drawWords();
  }

  /* ---------- 자막 줄 인스펙터 (2026-10-02 "자막도 인스펙터에 표시") ----------
     장면 자막 'r<번호>' 가 review.captions[번호] 다 (feedback.js sceneFromReview). 글 · 화자 · 디자인 · 시작 · 끝을 고친다.
     시작 · 끝은 이 타임라인 시각으로 보이고, 저장은 지금 구운 편집 시각 (s2 · e2) 으로 되돌려 적는다 - 렌더 단추가 컷을 따라 다시 옮긴다 */
  function plain(t) { return String(t || '').split('«').join('').split('»').join('').split('|')[0].trim(); }
  function capIndex(id) {
    if (!id) return -1;
    if (id.charAt(0) === 'l') {             // 설명 딱지: 장면이 그리지만 글은 review.captions 의 설명 줄 (피드백 탭과 같이 고친다)
      var sc = ((SC && SC.captions) || []).filter(function (c) { return c.id === id; })[0], L = (R && R.captions) || [];
      for (var i = 0; i < L.length; i++) {
        if ((L[i].speaker || '').trim() === '설명' && sc && (plain(L[i].text) === plain(sc.text) || plain(L[i].orig) === plain(sc.text))) return i;
      }
      return -1;
    }
    if (id.charAt(0) !== 'r' || id.charAt(1) === 'c') return -1;
    var n = +id.slice(1);
    return isNaN(n) ? -1 : n;
  }
  function toOld(t) {                      // 이 타임라인 시각 -> 지금 구운 편집 시각
    return D.Feedback.srcToEdit(D.Feedback.unplanned(plan(), t));
  }
  function capInspector(ins) {
    var sc = ((SC && SC.captions) || []).filter(function (c) { return c.id === CSEL; })[0];
    if (!sc) { CSEL = null; return false; }
    var i = capIndex(sc.id), c = R && i >= 0 ? (R.captions || [])[i] : null;
    ins.appendChild(D.el('div', { class: 'ue-ins-h', text: '자막' + (c ? ' ' + (i + 1) : ' (고칠 수 없는 줄)') }));
    var row = function (label, el) {
      var r = D.el('label', { class: 'ue-field' });
      r.appendChild(D.el('span', { text: label }));
      r.appendChild(el);
      ins.appendChild(r);
      return el;
    };
    var edit = function (fn) { remember(); fn(); c.by = 'user'; D.touch(); refreshScene(); draw(); };
    if (!c) { var ro = D.el('input', { type: 'text', value: sc.text }); ro.readOnly = true; row('글', ro); return true; }
    var ta = D.el('textarea', { class: 'ue-cap-text', rows: 3 });
    ta.value = c.text || '';
    ta.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ta.blur(); } });
    ta.addEventListener('change', function () {
      var v = ta.value.trim();
      if (v === (c.text || '')) return;
      edit(function () { if (c.orig == null) c.orig = c.text; c.text = v; });
    });
    row('글', ta);
    var spk = D.el('select'), spks = {};
    (R.captions || []).forEach(function (x) { if (x.speaker) spks[x.speaker] = 1; });
    Object.keys(spks).forEach(function (k) { spk.appendChild(D.el('option', { value: k, text: k })); });
    spk.value = c.speaker || '';
    spk.addEventListener('change', function () { edit(function () { c.speaker = spk.value; }); });
    row('화자', spk);
    var kd = D.el('select'), names = ((SC.style && SC.style.captions && SC.style.captions.kindNames) || {});
    var ks = Object.keys(names);
    if (c.kind && ks.indexOf(c.kind) < 0) ks.unshift(c.kind);
    if (!c.kind) ks.unshift('');
    ks.forEach(function (k) { kd.appendChild(D.el('option', { value: k, text: k || '(기본)' })); });
    kd.value = c.kind || '';
    kd.addEventListener('change', function () { edit(function () { c.kind = kd.value; }); });
    row('디자인', kd);
    var tf = function (label, val, key) {
      var inp = D.el('input', { type: 'text', value: tc(val) });
      inp.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter') return;
        var v = parseTC(inp.value);
        if (v == null) { D.toast('시각을 못 읽었습니다 (예: 00:00:12:30 또는 12.5)'); return; }
        edit(function () { c[key] = +toOld(v).toFixed(3); });
      });
      row(label, inp);
    };
    tf('시작', sc.s, 's2');
    tf('끝', sc.e, 'e2');
    var ln = D.el('input', { type: 'text', value: (sc.e - sc.s).toFixed(2) + 's' }); ln.readOnly = true;
    row('길이', ln);
    /* 자막으로 컷 더하기 · 빼기 (사용자 2026-10-02: "자막에 의해 컷 추가 / 삭제 할 때 미리보기에서 바로 볼 수도 없지").
       원본 시각을 앞당기면 그만큼 원본을 되살리고 늦추면 그만큼 뺀다 - 클립 목록을 바로 고쳐 미리보기에 곧장 보인다.
       줄은 os2 · oe2 (원본 시각) 에 선다 - 미리보기 (feedback.js planScene) 와 렌더 (apply_review.py) 가 같이 읽는다 */
    var s0 = c.os2 != null ? c.os2 : srcOfT(sc.s), e0 = c.oe2 != null ? c.oe2 : srcOfT(sc.e - 1e-3);
    var sf = function (label, val, isEnd) {
      var inp = D.el('input', { type: 'text', value: val != null ? stc(val) : '-' });
      inp.title = '원본 시각 - 앞당기면 그만큼 컷을 되살리고, 늦추면 그만큼 뺍니다 (미리보기에 바로)';
      inp.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter') return;
        var v = parseT(inp.value);
        if (v == null || s0 == null || e0 == null) { D.toast('시각을 못 읽었습니다 (예: 1:23.45 또는 83.45)'); return; }
        var a = isEnd ? s0 : v, b = isEnd ? v : e0;
        if (b - a < 0.1) { D.toast('끝이 시작보다 앞입니다'); return; }
        remember();
        if (!isEnd) { if (v < s0) restoreSrc(v, s0); else if (v > s0) removeSrc(s0, v); }
        else if (v > e0) restoreSrc(e0, v); else if (v < e0) removeSrc(v, e0);
        merge();
        c.os2 = +a.toFixed(3); c.oe2 = +b.toFixed(3); c.by = 'user';
        changed();
      });
      row(label, inp);
    };
    sf('원본 시작', s0, false);
    sf('원본 끝', e0, true);
    var cut = D.el('button', { class: 'ue-btn ue-cap-cut', title: '이 줄의 원본 구간을 컷에서 뺍니다 (Delete) - 되돌리기는 Ctrl+Z' });
    cut.appendChild(D.icon('trash')); cut.appendChild(D.el('span', { text: '이 줄 컷에서 빼기' }));
    cut.addEventListener('click', cutCaption);
    ins.appendChild(cut);
    return true;
  }
  function srcOfT(t) {                     // 이 타임라인 시각 -> 원본 시각 (그 자리 클립)
    var c = clipAt(t);
    return c ? c.s + (t - c.at) : null;
  }
  function cutCaption() {                  // 고른 자막 줄의 원본 구간을 컷에서 뺀다 (줄도 같이 사라진다 - 남은 말이 0.1초 미만)
    var sc = ((SC && SC.captions) || []).filter(function (x) { return x.id === CSEL; })[0];
    if (!sc) return;
    var i = capIndex(sc.id), c = R && i >= 0 ? (R.captions || [])[i] : null;
    var a = c && c.os2 != null ? c.os2 : srcOfT(sc.s), b = c && c.oe2 != null ? c.oe2 : srcOfT(sc.e - 1e-3);
    if (a == null || b == null || b - a < 0.05) { D.toast('이 줄은 컷 밖에 있습니다'); return; }
    remember();
    removeSrc(a, b);
    merge();
    CSEL = null;
    changed();
    D.toast('자막 줄 구간을 컷에서 뺐습니다 (Ctrl+Z 로 되돌림)');
  }
  function parseTC(s) {                    // 00:00:12:30 (프레임) 또는 초
    s = String(s || '').trim();
    var p = s.split(':');
    if (p.length === 4) return ((+p[0] * 60 + +p[1]) * 60 + +p[2]) + +p[3] / FPS;
    return parseT(s);
  }

  /* ---------- 전사 자막: 낱말 빼기 · 되살리기 (2026-10-02 "단어별 추가 제거") ----------
     낱말은 클립 목록을 바로 고친다 (클립 목록이 하나뿐인 정본). 뺄 때는 앞뒤 쉼의 가운데까지 잘라 낸다 - 낱말 끝에서 딱 자르면
     위스퍼 시각이 어긋난 만큼 말이 잘린다 (drop-snap-to-word-gaps). 되살릴 때는 앞 0.10 · 뒤 0.15초 여유 (피드백 탭과 같은 값) 를 붙여
     원본에서 바로 앞에 남아 있는 클립 뒤에 끼워 넣는다 (뒤는 민다) */
  var WALL = null, LASTW = null;
  /* 낱말 시각 바로잡기: 위스퍼 시각이 쉼 앞뒤에서 1초쯤 어긋난 편이 있다 (퍼리취향: "어 잠깐만" 이 7.78초인데 실제는 첫 조각 8.72초 안 -
     파이프라인의 keep 은 남았다고 하는데 시각으로 재면 잘린 쪽). keep 이 정본이다: keep 인데 AI 조각 (review.clips) 밖인 낱말 덩이는
     가장 가까운 조각 끝 안으로 통째로 옮겨 잰다 (사이 간격은 그대로) */
  function allWords() {
    if (WALL) return WALL;
    WALL = [];
    ((R && R.transcript) || []).forEach(function (sg, si) {
      (sg.words || []).forEach(function (w, wi) { WALL.push({ w: w, k: si + ':' + wi, s: w.s, e: w.e }); });
    });
    WALL.sort(function (a, b) { return a.s - b.s; });
    var K = (R && R.clips) || [];
    var inK = function (x) { return K.some(function (k) { return Math.min(x.e, k.e) - Math.max(x.s, k.s) >= 0.5 * Math.max(0.001, x.e - x.s); }); };
    var run = [];
    var fix = function () {
      if (!run.length) return;
      var a = run[0], b = run[run.length - 1], best = null, off = 0;
      K.forEach(function (k) {
        /* 조각 앞 · 뒤에 있거나 걸쳐 있으면 (잠깐만 7.97-9.07 이 조각 8.72 에 0.35초만 걸침) 조각 안으로 */
        var o = a.s < k.s && b.e > k.s - 3 && a.s < k.s ? k.s + 0.02 - a.s : b.e > k.e && a.s < k.e + 3 ? k.e - 0.02 - b.e : 0;
        if (o && (best == null || Math.abs(o) < Math.abs(off))) { best = k; off = o; }
      });
      if (best && Math.abs(off) < 3) run.forEach(function (x) { x.s += off; x.e += off; });
      run = [];
    };
    WALL.forEach(function (x) { if (x.w.keep && !inK(x)) run.push(x); else fix(); });
    fix();
    return WALL;
  }
  function covered(x) {
    var d = Math.max(0.001, x.e - x.s), got = 0;
    CL.forEach(function (c) { got += Math.max(0, Math.min(x.e, c.e) - Math.max(x.s, c.s)); });
    return got >= 0.5 * d;
  }
  function srcToT(t) {
    var r = null;
    CL.forEach(function (c) { if (t >= c.s - 1e-3 && t < c.e) r = c; });
    return r ? r.at + (t - r.s) : 0;
  }
  function wordOf(el) {
    var sp = el && el.closest && el.closest('.ue-w');
    if (!sp) return null;
    var k = sp.dataset.k, A = allWords();
    for (var i = 0; i < A.length; i++) if (A[i].k === k) return A[i];
    return null;
  }
  function removeSrc(a, b) {
    var out = [];
    sorted().forEach(function (c) {
      if (b <= c.s || a >= c.e) { out.push(c); return; }
      if (a > c.s + 1e-3) out.push({ id: c.id, s: c.s, e: a, at: c.at });
      if (b < c.e - 1e-3) out.push({ id: UID++, s: b, e: c.e, at: c.at + (b - c.s) });
    });
    CL = out;
    if (RIP) pack();
  }
  function restoreSrc(a, b) {
    var parts = [[Math.max(0, a), Math.min(b, srcDur())]];
    CL.forEach(function (c) {                // 이미 남은 원본은 빼고 새로 들어올 토막만
      var Q = [];
      parts.forEach(function (p) {
        if (c.e <= p[0] || c.s >= p[1]) { Q.push(p); return; }
        if (c.s > p[0] + 1e-3) Q.push([p[0], c.s]);
        if (c.e < p[1] - 1e-3) Q.push([c.e, p[1]]);
      });
      parts = Q;
    });
    parts.forEach(function (p) {
      var L = p[1] - p[0];
      if (L < 0.02) return;
      var prev = null;
      CL.forEach(function (c) { if (c.e <= p[0] + 0.002 && (!prev || c.e > prev.e)) prev = c; });
      var at = prev ? end(prev) : 0;
      CL.forEach(function (c) { if (c !== prev && c.at >= at - 1e-4) c.at += L; });
      if (prev && Math.abs(prev.e - p[0]) < 0.002) prev.e = p[1];        // 바로 이어지면 그 클립을 늘인다
      else CL.push({ id: UID++, s: p[0], e: p[1], at: at });
    });
  }
  function toggleWords(ws, on) {
    remember();
    ws.forEach(function (w) {
      if (on) { restoreSrc(w.s - 0.10, w.e + 0.15); return; }
      var A = allWords(), i = A.indexOf(w);
      var pv = i > 0 ? A[i - 1] : null, nx = i >= 0 && i + 1 < A.length ? A[i + 1] : null;
      var a = pv && pv.e <= w.s ? (pv.e + w.s) / 2 : w.s - 0.05, b = nx && nx.s >= w.e ? (w.e + nx.s) / 2 : w.e + 0.05;
      removeSrc(a, b);
    });
    merge();
    changed();
  }
  function merge() {                      // 원본도 타임라인도 바로 이어지는 클립은 하나로 (낱말을 빼고 되살리면 둘로 남았다)
    var S = sorted(), out = [];
    S.forEach(function (c) {
      var l = out[out.length - 1];
      if (l && Math.abs(l.e - c.s) < 0.002 && Math.abs(end(l) - c.at) < 0.002) l.e = c.e;
      else out.push(c);
    });
    CL = out;
  }
  function onWord(ev) {
    var w = wordOf(ev.target);
    if (!w) return;
    var on = !covered(w), ws = [w];
    if (ev.shiftKey && LASTW) {              // Shift: 앞에 누른 낱말부터 여기까지 같이
      var A = allWords(), i0 = A.indexOf(LASTW), i1 = A.indexOf(w);
      if (i0 >= 0 && i1 >= 0) ws = A.slice(Math.min(i0, i1), Math.max(i0, i1) + 1).filter(function (x) { return covered(x) !== on; });
    }
    LASTW = w;
    toggleWords(ws, on);
  }
  function drawWords() {
    var box = D.$('#ueWords');
    if (!box || PANE !== 'words') return;
    var keep = box.scrollTop;
    box.textContent = '';
    var segs = (R && R.transcript) || [];
    if (!segs.length) { box.appendChild(D.el('div', { class: 'ue-ins-empty', text: '전사가 없습니다' })); return; }
    box.appendChild(D.el('div', { class: 'ue-words-hint', text: '낱말을 누르면 빼고 / 되살립니다 · Shift 로 여럿 · 두 번 누르면 그 자리로' }));
    var byK = {};
    allWords().forEach(function (x) { byK[x.k] = x; });
    segs.forEach(function (sg, si) {
      var ws = sg.words || [];
      if (!ws.length) return;
      var p = D.el('div', { class: 'ue-seg' });
      p.appendChild(D.el('span', { class: 'ue-seg-t', text: stc(byK[si + ':0'] ? byK[si + ':0'].s : ws[0].s) }));
      ws.forEach(function (w, wi) {
        var sp = D.el('span', { class: 'ue-w' + (covered(byK[si + ':' + wi]) ? '' : ' is-cut'), text: w.w });
        sp.dataset.k = si + ':' + wi;
        p.appendChild(sp);
      });
      box.appendChild(p);
    });
    box.scrollTop = keep;
  }

  /* ---------- 도구 · 단축키 (리졸브와 같은 글쇠) ---------- */
  function setTool(t) {
    TOOL = t;
    D.$$('#view-edit [data-tool]').forEach(function (b) { b.classList.toggle('is-on', b.dataset.tool === t); });
  }
  function setSnap(on) { SNAP = on; var b = D.$('#ueSnapBtn'); if (b) b.classList.toggle('is-on', on); }
  function setRipple(on) { RIP = on; var b = D.$('#ueRipBtn'); if (b) b.classList.toggle('is-on', on); }
  function jumpEdit(dir) {
    var t = now(), E = edits(), x = null;
    if (dir > 0) { for (var i = 0; i < E.length; i++) if (E[i] > t + 1e-4) { x = E[i]; break; } }
    else { for (var j = E.length - 1; j >= 0; j--) if (E[j] < t - 1e-4) { x = E[j]; break; } }
    if (x != null) seek(x);
  }
  function key(ev) {
    var k = ev.key, low = (k || '').toLowerCase(), ctrl = ev.ctrlKey || ev.metaKey, v = video();
    if (ctrl) {
      if (low === 'z') { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); }
      else if (low === 'y') { ev.preventDefault(); redo(); }
      else if (low === 'b') { ev.preventDefault(); splitAtPlayhead(); }
      else if (low === 'a') { ev.preventDefault(); SEL = {}; CL.forEach(function (c) { SEL[c.id] = true; }); draw(); }
      else if (k === '=' || k === '+') { ev.preventDefault(); zoomBy(1.25); }
      else if (k === '-') { ev.preventDefault(); zoomBy(0.8); }
      return;
    }
    switch (k) {
      case ' ': ev.preventDefault(); toggle(); break;
      case 'ArrowLeft': ev.preventDefault(); seek(now() - (ev.shiftKey ? 1 : 1 / FPS)); break;
      case 'ArrowRight': ev.preventDefault(); seek(now() + (ev.shiftKey ? 1 : 1 / FPS)); break;
      case 'ArrowUp': ev.preventDefault(); jumpEdit(-1); break;
      case 'ArrowDown': ev.preventDefault(); jumpEdit(1); break;
      case 'Home': ev.preventDefault(); seek(0); break;
      case 'End': ev.preventDefault(); seek(total()); break;
      case 'Delete': case 'Backspace': ev.preventDefault(); if (CSEL && !selected().length) cutCaption(); else removeSel(); break;
      case 'Escape': pick(null); break;
      default:
        if (low === 'a') setTool('select');
        else if (low === 'b') setTool('blade');
        else if (low === 'n') setSnap(!SNAP);
        else if (low === 'j') seek(now() - 1);
        else if (low === 'k') { if (v) v.pause(); }
        else if (low === 'l') { if (v && v.paused) toggle(); }
        else if (k === 'Z') fit();
    }
  }

  /* ---------- 불러오기 · 보이기 ---------- */
  function load(review) {
    R = review || null;
    UNDO = []; REDO = []; SEL = {}; CSEL = null; MINW = 0; CL = []; WALL = null; LASTW = null;
    SC = null; BINS = {}; FSEL = null;
    if (R && (R.clips || []).length) {
      var src = R.userClips && R.userClips.length ? R.userClips.map(function (c) { return [c.s, c.e, c.at]; }) : D.Feedback.basePlan();
      CL = src.map(function (r) { return { id: UID++, s: r[0], e: r[1], at: r[2] }; });
    }
    D.$('#ueEmpty').hidden = !!CL.length;
    loadMedia();
    drawBins();
    draw();
    if (SHOWN) { mountPlayer(); setTimeout(fit, 0); }
  }
  function resetToAI() {
    if (!R || !R.userClips) { D.toast('이미 AI 컷 그대로입니다'); return; }
    remember();
    delete R.userClips;
    CL = D.Feedback.basePlan().map(function (r) { return { id: UID++, s: r[0], e: r[1], at: r[2] }; });
    SEL = {};
    D.touch(); draw(); refreshScene();
    D.toast('AI 컷으로 되돌림 (Ctrl+Z 로 취소)');
  }
  function shown(on) {
    SHOWN = on;
    if (!on) { var v = video(); if (v && !v.paused) v.pause(); unmountPlayer(); return; }
    mountPlayer();
    setTimeout(function () { fitViewer(); draw(); if (PPS === 80 && total()) fit(); }, 0);
  }

  function mount() {
    var sc = scroller();
    if (!sc) return;
    sc.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    sc.addEventListener('wheel', function (ev) {
      if (!(ev.ctrlKey || ev.metaKey || ev.altKey)) return;             // 그냥 바퀴는 가로 넘기기 (브라우저)
      ev.preventDefault();
      var r = sc.getBoundingClientRect();
      zoomBy(ev.deltaY < 0 ? 1.15 : 1 / 1.15, ev.clientX - r.left);
    }, { passive: false });
    D.$$('#view-edit [data-tool]').forEach(function (b) { b.addEventListener('click', function () { setTool(b.dataset.tool); }); });
    D.$('#ueSnapBtn').addEventListener('click', function () { setSnap(!SNAP); });
    D.$('#ueRipBtn').addEventListener('click', function () { setRipple(!RIP); });
    D.$('#ueSplit').addEventListener('click', splitAtPlayhead);
    D.$('#ueDel').addEventListener('click', removeSel);
    D.$('#ueUndo').addEventListener('click', undo);
    D.$('#ueRedo').addEventListener('click', redo);
    D.$('#ueFit').addEventListener('click', fit);
    D.$('#ueReset').addEventListener('click', resetToAI);
    D.$('#ueAddFolder').addEventListener('click', addFolder);
    D.$('#uePlay').addEventListener('click', toggle);
    D.$('#ueStart').addEventListener('click', function () { seek(0); });
    D.$('#ueEnd').addEventListener('click', function () { seek(total()); });
    D.$('#uePrev').addEventListener('click', function () { jumpEdit(-1); });
    D.$('#ueNext').addEventListener('click', function () { jumpEdit(1); });
    D.$('#ueZoom').addEventListener('input', function (ev) {
      var sc2 = scroller(), t = T(sc2.scrollLeft + sc2.clientWidth / 2);
      PPS = Math.exp(+ev.target.value); MINW = 0; draw();
      sc2.scrollLeft = Math.max(0, X(t) - sc2.clientWidth / 2);
    });
    D.$$('#view-edit .ue-tab').forEach(function (b) { b.addEventListener('click', function () { showPane(b.dataset.pane); }); });
    D.$('#ueWords').addEventListener('click', onWord);
    D.$('#ueWords').addEventListener('dblclick', function (ev) { var w = wordOf(ev.target); if (w && covered(w)) seek(srcToT(w.s)); });
    if (window.ResizeObserver) {
      new ResizeObserver(function () { fitViewer(); }).observe(D.$('#ueViewer'));
      new ResizeObserver(function () { if (SHOWN) draw(); }).observe(sc);
      new ResizeObserver(function () { if (SHOWN) draw(); }).observe(D.$('#view-edit .ue-timeline'));
    }
    setTool('select'); setSnap(true); setRipple(true);
  }

  D.UserEdit = { mount: mount, load: load, shown: shown, key: key, clips: function () { return sorted(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})(window.D);
