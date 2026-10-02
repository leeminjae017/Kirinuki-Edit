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
  var TOOL = 'select';     // select | blade
  var SNAP = true, RIP = true;
  var PPS = 80;            // 1초 = px
  var FPS = 60;
  var SP = null, SHOWN = false, SC = null, MOUNTING = false;
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
    var w = R && R.wave;
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
  function snapshot() { return JSON.stringify(CL); }
  function remember() { UNDO.push(snapshot()); if (UNDO.length > 200) UNDO.shift(); REDO = []; }
  function restoreState(js) { CL = JSON.parse(js); SEL = {}; changed(); }
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

  /* ---------- 미리보기 ---------- */
  function video() { return SP ? SP.video : null; }
  function now() { var v = video(); return v ? v.currentTime || 0 : (drag && drag.t != null ? drag.t : 0); }
  function urlOf(path) { return '/api/file?path=' + encodeURIComponent(path); }
  function viewerMsg(msg) {
    var host = D.$('#ueViewer');
    var m = host.querySelector('.ue-msg');
    if (!msg) { if (m) m.remove(); return; }
    if (!m) { m = D.el('div', { class: 'ue-msg' }); host.appendChild(m); }
    m.textContent = msg;
  }
  function mountPlayer() {
    if (SP || MOUNTING || !R) return;
    if (!R.srcPreview) { viewerMsg('원본 사본이 없어 미리보기를 못 합니다 - 내보내기를 다시 해 주세요 (tools/src_preview.py)'); return; }
    if (!window.ShortsmithPreview || !D.Feedback.ready()) {
      viewerMsg('미리보기 준비 중...');
      MOUNTING = true;
      setTimeout(function () { MOUNTING = false; if (SHOWN) mountPlayer(); }, 400);
      return;
    }
    SC = D.Feedback.sceneFor(plan());
    if (!SC) return;
    FPS = SC.fps || 60;
    viewerMsg('');
    var host = D.el('div', { class: 'ue-player' });
    D.$('#ueViewer').appendChild(host);
    SP = window.ShortsmithPreview.mount(host, { scene: SC, url: urlOf });
    var v = SP.video;
    v.addEventListener('play', function () { icon('pause'); loop(); });
    v.addEventListener('pause', function () { icon('play'); drawPlayhead(); });
    v.addEventListener('seeked', drawPlayhead);
    v.addEventListener('loadedmetadata', function () { fitViewer(); drawPlayhead(); });
    fitViewer();
    draw();
  }
  function unmountPlayer() {
    if (SP) { try { SP.video.pause(); SP.unmount(); } catch (e) { /* 없어도 된다 */ } SP = null; }
    var h = D.$('#ueViewer .ue-player');
    if (h) h.remove();
  }
  function refreshScene() {
    if (!SP) return;
    var t = now();
    SC = D.Feedback.sceneFor(plan());
    if (!SC) return;
    SP.update(SC);
    var v = video();
    if (v) v.currentTime = Math.min(t, Math.max(0, total() - 1 / FPS));   // 고쳐도 보던 시각을 지킨다
    drawCaps();
  }
  function fitViewer() {                   // 그림 상자를 화면 비율 그대로 칸 안에 꽉
    var box = D.$('#ueViewer'), host = box && box.querySelector('.ue-player');
    if (!host || !SC) return;
    var W = box.clientWidth - 16, H = box.clientHeight - 16, ar = SC.width / SC.height;
    var w = Math.min(W, H * ar), h = w / ar;
    host.style.width = Math.floor(w) + 'px'; host.style.height = Math.floor(h) + 'px';
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
    var lv = D.$('#ueLaneV'), la = D.$('#ueLaneA');
    lv.textContent = ''; la.textContent = '';
    sorted().forEach(function (c, i) {
      [['v', lv], ['a', la]].forEach(function (kv) {
        var el = D.el('div', { class: 'ue-clip ue-' + kv[0] + (SEL[c.id] ? ' is-sel' : '') });
        el.style.left = X(c.at) + 'px';
        el.style.width = Math.max(2, X(len(c))) + 'px';
        el.dataset.id = c.id;
        if (kv[0] === 'v') {
          el.appendChild(D.el('span', { class: 'ue-clip-name', text: (i + 1) + '  ' + stc(c.s) + ' - ' + stc(c.e) }));
        } else {
          wave(el, c);
        }
        el.appendChild(D.el('i', { class: 'ue-trim ue-trim-l' }));
        el.appendChild(D.el('i', { class: 'ue-trim ue-trim-r' }));
        kv[1].appendChild(el);
      });
    });
    drawCaps();
    drawPlayhead();
    side();
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
  var WB = null, WSRC = '', WLO = 0, WHI = 255;
  function waveBytes() {
    var w = R && R.wave;
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
  function wave(el, c) {                   // 원본 소리 파형 (피드백 탭과 같은 눈금 - 바닥 잡음 10% 가 0)
    var B = waveBytes();
    if (!B) return;
    var hz = R.wave.hz || 50, dpr = window.devicePixelRatio || 1;
    var W = Math.min(4000, Math.max(2, Math.round(X(len(c))))), H = 40;
    var cv = document.createElement('canvas');
    cv.className = 'ue-wave';
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
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
    ((SC && SC.captions) || []).forEach(function (c) {
      if (!(c.e > c.s)) return;
      var el = D.el('div', { class: 'ue-cap', title: c.text });
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

  /* ---------- 옆 칸: 클립 목록 · 클립 정보 ---------- */
  function side() {
    var list = D.$('#ueList');
    if (list) {
      list.textContent = '';
      sorted().forEach(function (c, i) {
        var row = D.el('div', { class: 'ue-row' + (SEL[c.id] ? ' is-sel' : '') });
        row.appendChild(D.el('span', { class: 'ue-row-n', text: String(i + 1) }));
        row.appendChild(D.el('span', { class: 'ue-row-t', text: tc(c.at) }));
        row.appendChild(D.el('span', { class: 'ue-row-s', text: stc(c.s) + ' - ' + stc(c.e) }));
        row.appendChild(D.el('span', { class: 'ue-row-d', text: len(c).toFixed(2) + 's' }));
        row.addEventListener('click', function (ev) { pick(c.id, ev.shiftKey); });
        row.addEventListener('dblclick', function () { seek(c.at); });          // 시점 옮기기는 두 번 눌러야
        list.appendChild(row);
      });
    }
    var ins = D.$('#ueIns');
    if (!ins) return;
    ins.textContent = '';
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
    CL = JSON.parse(drag.base);
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
      CL = JSON.parse(d.base);
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
    after = snapshot();
    CL = JSON.parse(d.base); remember(); CL = JSON.parse(after);
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
      case 'Delete': case 'Backspace': ev.preventDefault(); removeSel(); break;
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
    UNDO = []; REDO = []; SEL = {}; MINW = 0; CL = [];
    unmountPlayer(); SC = null;
    if (R && (R.clips || []).length) {
      var src = R.userClips && R.userClips.length ? R.userClips.map(function (c) { return [c.s, c.e, c.at]; }) : D.Feedback.basePlan();
      CL = src.map(function (r) { return { id: UID++, s: r[0], e: r[1], at: r[2] }; });
    }
    D.$('#ueEmpty').hidden = !!CL.length;
    var nm = D.$('#ueSrcName');
    if (nm) nm.textContent = R && R.srcPreview ? String(R.srcPreview.path || '').split('/').pop() : '-';
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
    if (!on) { var v = video(); if (v) v.pause(); return; }
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
    D.$('#ueRender').addEventListener('click', function () {
      var b = D.$('#btnFbRender');
      if (!b) return;
      D.toast('렌더 시작 - 진행은 피드백 탭 렌더 칸에');
      b.click();
    });
    if (window.ResizeObserver) {
      new ResizeObserver(function () { fitViewer(); }).observe(D.$('#ueViewer'));
      new ResizeObserver(function () { if (SHOWN) draw(); }).observe(sc);
    }
    setTool('select'); setSnap(true); setRipple(true);
  }

  D.UserEdit = { mount: mount, load: load, shown: shown, key: key, clips: function () { return sorted(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})(window.D);
