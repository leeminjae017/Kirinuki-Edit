/* ==========================================================================
   inspector.js - 선택 요소 수정 (자막: 화자 / 내용 / 디자인)

   여기 있는 것을 전부 펼쳐 놓으면 정작 고치러 온 것이 화면 밖으로 밀려난다.
   그래서 세 층으로 나눈다.

     머리띠   클립이 무엇인지 한 줄 (이름 · 시각). 누르면 목록이 열린다
     목록     트랙 · 시작 · 길이 · 끝 · 소스. 읽기만 한다
     설정 창  숫자를 실제로 고치는 곳. "상세 정보"를 눌러야 뜬다

   많이 쓰는 것(자막 내용, 폰트 · 크기 · 색)만 늘 펼쳐 두고, 화면 자리나
   크롭처럼 한 번 맞추면 끝인 것은 이름만 남겨 접어 둔다.
   ========================================================================== */
(function (D) {
  'use strict';

  var E = D.state.editor;
  var box, tag, subsBox, mode = 'clip';
  /* 머리띠를 열어 둔 채로 다른 클립을 고르면 계속 열려 있어야 한다.
     다시 그릴 때마다 닫히면 목록을 보며 클립을 훑을 수가 없다. */
  var stripOpen = false;

  function row(label, node) {
    var r = D.el('div', { class: 'insp-row' });
    r.appendChild(D.el('label', { text: label }));
    r.appendChild(node);
    return r;
  }

  function sec(title, nodes) {
    var s = D.el('div', { class: 'insp-sec' });
    if (title) s.appendChild(D.el('div', { class: 'insp-sec-title', text: title }));
    nodes.forEach(function (n) { if (n) s.appendChild(n); });
    return s;
  }

  /* 접어 두는 묶음. 한 번 맞추면 다시 안 보는 것들이 여기로 간다. */
  function fold(title, nodes, open) {
    var d = D.el('details', { class: 'ins-fold' });
    if (open) d.setAttribute('open', '');
    d.appendChild(D.el('summary', { text: title }));
    var b = D.el('div', { class: 'ins-fold-body' });
    nodes.forEach(function (n) { if (n) b.appendChild(n); });
    d.appendChild(b);
    return d;
  }

  function num(value, step, onChange) {
    var i = D.el('input', { class: 'input', type: 'number', step: step, value: D.round(value, 3) });
    i.addEventListener('change', function () {
      var v = parseFloat(i.value);
      if (isNaN(v)) { i.value = D.round(value, 3); return; }
      onChange(v);
    });
    return i;
  }

  function ro(value) {
    var i = D.el('input', { class: 'input mono', value: value });
    i.disabled = true;
    return i;
  }

  function range(value, min, max, step, unit, onChange) {
    var wrap = D.el('div', { class: 'range-row' });
    var r = D.el('input', { type: 'range', min: min, max: max, step: step, value: value });
    var v = D.el('span', { class: 'val', text: value + (unit || '') });
    r.addEventListener('input', function () {
      v.textContent = r.value + (unit || '');
      onChange(parseFloat(r.value));
    });
    wrap.appendChild(r); wrap.appendChild(v);
    return wrap;
  }

  function color(value, onChange) {
    var wrap = D.el('div', { class: 'color-row' });
    var c = D.el('input', { type: 'color', value: /^#/.test(value) ? value : '#ffffff' });
    var t = D.el('input', { class: 'input mono', value: value });
    c.addEventListener('input', function () { t.value = c.value; onChange(c.value); });
    t.addEventListener('change', function () { onChange(t.value); if (/^#[0-9a-f]{6}$/i.test(t.value)) c.value = t.value; });
    wrap.appendChild(c); wrap.appendChild(t);
    return wrap;
  }

  function toggleSeg(options, current, onChange) {
    var s = D.el('div', { class: 'seg' });
    options.forEach(function (o) {
      var b = D.el('button', { class: current === o.v ? 'is-on' : '', text: o.label });
      b.addEventListener('click', function () {
        D.$$('button', s).forEach(function (x) { x.classList.remove('is-on'); });
        b.classList.add('is-on');
        onChange(o.v);
      });
      s.appendChild(b);
    });
    return s;
  }

  function iconBtn(icon, title, onClick) {
    var b = D.el('button', { class: 'btn btn-icon btn-sm', title: title });
    b.appendChild(D.icon(icon));
    b.addEventListener('click', onClick);
    return b;
  }

  function commit(msg) {
    D.TL.render();
    D.emit('preview:refresh');
    D.touch();
    if (msg) D.info(msg, 'edit');
  }

  function assetOf(c) {
    return E.assets.filter(function (a) { return a.id === c.assetId; })[0] || null;
  }

  /* ==================== 클립 머리띠 ====================

     클립을 고르면 이 한 줄만 나온다. 눌러야 목록이 열리고, 목록에서
     "상세 정보"를 눌러야 숫자를 고치는 창이 뜬다. */

  function clipStrip(c) {
    var t = D.TL.track(c.trackId);
    var wrap = D.el('div', { class: 'insp-sec' });

    var strip = D.el('button', {
      class: 'ins-strip k-' + c.kind,
      'aria-expanded': stripOpen ? 'true' : 'false',
      title: '클립 정보 열기 · 닫기'
    });
    strip.appendChild(D.el('i', { class: 'bar' }));
    strip.appendChild(D.icon(D.KIND_ICON[c.kind]));
    strip.appendChild(D.el('span', {
      class: 'nm',
      text: c.kind === 'caption' ? (c.text || '(빈 자막)') : c.name
    }));
    strip.appendChild(D.el('span', {
      class: 'tc',
      text: D.fmtTime(c.start).slice(2) + ' · ' + D.fmtDur(c.dur)
    }));
    strip.appendChild(D.icon('chev', 'ins-chev'));

    var drop = D.el('div', { class: 'ins-drop' });
    drop.hidden = !stripOpen;

    var kv = D.el('dl', { class: 'ins-kv' });
    function put(k, v) {
      kv.appendChild(D.el('dt', { text: k }));
      kv.appendChild(D.el('dd', { text: v, title: v }));
    }
    put('트랙', (t ? t.name : '?') + ' · ' + D.KIND_LABEL[c.kind]);
    put('시작', D.fmtTime(c.start));
    put('길이', D.fmtDur(c.dur));
    put('끝', D.fmtTime(c.start + c.dur));
    if (c.kind !== 'caption') put('소스 시작', D.fmtTime(c.offset || 0));
    if (c.kind !== 'caption') {
      var a = assetOf(c);
      put('소스', a ? a.name : '(연결 없음)');
    }
    if (c.groupId) {
      var n = E.clips.filter(function (x) { return x.groupId === c.groupId; }).length;
      put('동기화', n + '개 클립' + (E.sync ? ' (함께 이동)' : ' (동기화 꺼짐)'));
    }
    drop.appendChild(kv);

    var detail = D.el('button', { class: 'btn btn-sm', text: '상세 정보' });
    detail.addEventListener('click', function () { openDetail(c); });
    drop.appendChild(detail);

    strip.addEventListener('click', function () {
      stripOpen = !stripOpen;
      drop.hidden = !stripOpen;
      strip.setAttribute('aria-expanded', stripOpen ? 'true' : 'false');
    });

    wrap.appendChild(strip);
    wrap.appendChild(drop);
    return wrap;
  }

  /* 숫자를 실제로 고치는 창. 인스펙터 본문에 늘 펼쳐 두던 것을 여기로 옮겼다. */
  function openDetail(c) {
    function body() {
      var b = D.el('div', { class: 'insp-sec' });
      var t = D.TL.track(c.trackId);
      var a = assetOf(c);

      var nameInput = D.el('input', { class: 'input', value: c.name });
      nameInput.addEventListener('change', function () {
        c.name = nameInput.value; commit('클립 이름 변경: ' + c.name); refresh();
      });

      b.appendChild(row('이름', nameInput));
      b.appendChild(row('시작', num(c.start, 0.01, function (v) {
        c.start = Math.max(0, v); commit('시작 시간 변경: ' + D.fmtTime(c.start)); refresh();
      })));
      b.appendChild(row('길이', num(c.dur, 0.01, function (v) {
        c.dur = Math.max(0.1, v); commit('길이 변경: ' + D.fmtDur(c.dur)); refresh();
      })));
      b.appendChild(row('끝', ro(D.fmtTime(c.start + c.dur))));
      if (c.kind !== 'caption') {
        b.appendChild(row('소스 시작', num(c.offset, 0.01, function (v) {
          c.offset = Math.max(0, v); commit('소스 오프셋 변경'); refresh();
        })));
        b.appendChild(row('소스', ro(a ? a.name : '(연결 없음)')));
      }
      b.appendChild(row('트랙', ro((t ? t.name : '?') + ' · ' + D.KIND_LABEL[c.kind])));

      if (c.groupId) {
        var n = E.clips.filter(function (x) { return x.groupId === c.groupId; }).length;
        var g = D.el('div', { class: 'insp-sec' });
        g.appendChild(D.el('p', {
          class: 'hint',
          text: '동기화 그룹 ' + n + '개 클립' + (E.sync ? ' · 함께 이동합니다' : ' · 동기화가 꺼져 개별 이동합니다')
        }));
        var rel = D.el('button', { class: 'btn btn-sm', text: '그룹 해제' });
        rel.addEventListener('click', function () {
          c.groupId = null; commit('동기화 그룹 해제: ' + c.name); refresh();
        });
        g.appendChild(rel);
        b.appendChild(g);
      }
      return b;
    }

    function refresh() {
      var host = D.$('#modalBody');
      if (!host) return;
      host.innerHTML = '';
      host.appendChild(body());
      render();
    }

    D.modal.open({
      title: D.KIND_LABEL[c.kind] + ' 클립 상세',
      body: body(),
      buttons: [{ label: '닫기' }]
    });
  }

  /* ==================== 렌더링 설정 (선택 없음) ====================

     고를 클립이 없을 때 이 자리가 비어 있었다. 렌더는 편집이 끝나고 누르는
     것이라 아무것도 안 골라 둔 때가 대부분인데, 그때 정작 아무것도 없었다.
     그래서 선택이 없으면 렌더링 설정 · 언어 · 진행이 여기 온다. */

  function langText(raw) {
    return String(raw || '').split(/[,\s]+/).map(function (x) { return x.trim(); })
      .filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 12);
  }

  function planLine() {
    var plan = D.Editor.renderPlan();
    var rep = plan.report;
    var wrap = D.el('div', { class: 'ins-plan' });
    if (!rep.caps.length) {
      wrap.appendChild(D.el('p', { class: 'hint', text: '자막이 없습니다.' }));
      return wrap;
    }
    var share = Math.round(rep.share * 100);
    wrap.appendChild(D.el('p', {
      class: 'hint',
      text: '자막 ' + rep.caps.length + '장 · ' + (rep.main || '?') + ' ' + share + '%'
        + (plan.trusted ? '' : ' — 한 언어로 모이지 않습니다')
    }));
    plan.direct.forEach(function (d) {
      wrap.appendChild(D.el('div', {
        class: 'plan-row is-go',
        text: d.lang + (d.reused ? ' — 옮겨 둔 자막 그대로' : ' — 바로 굽습니다')
      }));
    });
    plan.viaAI.forEach(function (v) {
      wrap.appendChild(D.el('div', {
        class: 'plan-row is-ai',
        text: v.lang + ' — 자막 ' + v.fix.length + '장을 클로드가 옮깁니다'
      }));
    });
    return wrap;
  }

  function secs(n) {
    n = Math.max(0, Math.round(n || 0));
    if (n < 60) return n + '초';
    return Math.floor(n / 60) + '분 ' + (n % 60) + '초';
  }

  function progressBox(rec) {
    if (!rec) return null;
    var w = D.el('div', { class: 'ins-prog' });
    var running = rec.state === 'running';
    var pct = rec.percent === undefined ? (running ? 0 : 100) : rec.percent;

    /* 막대. 지난 렌더의 단계별 시간을 모르면(이 폴더의 첫 렌더) 남은 시간을
       말할 수 없다 - 그럴 땐 줄무늬로 "어림이다"라고 알린다. */
    var bar = D.el('div', {
      class: 'prog-bar'
        + (rec.state === 'error' ? ' is-bad' : '')
        + (running && !rec.estimated ? ' is-rough' : '')
    });
    var fill = D.el('i');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    w.appendChild(bar);

    var parts = [pct + '%'];
    if (rec.elapsed !== undefined) parts.push(secs(rec.elapsed) + ' 지남');
    if (running && rec.eta !== null && rec.eta !== undefined) {
      parts.push('약 ' + secs(rec.eta) + ' 남음');
    } else if (running && !rec.estimated) {
      parts.push('남은 시간은 다음 렌더부터 나옵니다');
    }
    if (rec.state === 'done') parts = [secs(rec.elapsed) + ' 걸렸습니다'];
    if (rec.state === 'error') parts = ['실패 · ' + secs(rec.elapsed) + ' 지남'];
    w.appendChild(D.el('p', { class: 'prog-meta', text: parts.join(' · ') }));

    (rec.steps || []).forEach(function (label, i) {
      var st = running
        ? (i < rec.step ? 'done' : i === rec.step ? 'now' : 'wait')
        : (rec.state === 'error' && i === rec.step ? 'bad' : i <= rec.step ? 'done' : 'wait');
      if ((rec.skipped || []).indexOf(label) !== -1) st = 'skip';
      var row = D.el('div', { class: 'prog-row is-' + st, text: label });
      if (st === 'skip') row.appendChild(D.el('span', { class: 'why', text: '건너뜀' }));
      if (st === 'now' && rec.stepElapsed) {
        row.appendChild(D.el('span', { class: 'why', text: secs(rec.stepElapsed) }));
      }
      w.appendChild(row);
    });
    if (rec.error) w.appendChild(D.el('p', { class: 'prog-err', text: rec.error }));
    (rec.outputs || []).forEach(function (path) {
      w.appendChild(D.el('div', { class: 'prog-out mono', text: path, title: path }));
    });
    var tail = (rec.log || []).slice(-6);
    if (tail.length) {
      w.appendChild(D.el('pre', { class: 'prog-log', text: tail.join('\n') }));
    }
    return w;
  }

  /* ---------- 폴더 고르기 ----------

     브라우저의 파일 고르기 창은 진짜 경로를 안 내준다 (파일 이름만 준다).
     그래서 폴더는 서버가 읽어서 보여 주고 그 목록에서 고른다. 작업 폴더
     밖은 보이지 않는다 - 서버가 거기까지만 내준다. */
  function pickFolder(title, current, onPick) {
    var body = D.el('div', { class: 'dirpick' });
    var crumb = D.el('div', { class: 'dirpick-path mono' });
    var list = D.el('div', { class: 'dirpick-list' });
    var note = D.el('p', { class: 'hint' });      /* 오류만 적는다 */
    body.appendChild(crumb);
    body.appendChild(list);
    body.appendChild(note);

    var at = '';
    function draw(path) {
      list.innerHTML = '';
      fetch('/api/dirs?path=' + encodeURIComponent(path || ''))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok) { note.textContent = d.error || '폴더를 읽지 못했습니다'; return; }
          at = d.path;
          crumb.textContent = '작업 폴더' + (at ? ' / ' + at : '');
          note.textContent = '';
          if (d.parent !== null) {
            var up = D.el('button', { class: 'dirpick-row is-up' });
            up.appendChild(D.el('span', { class: 'nm', text: '.. 상위 폴더' }));
            up.addEventListener('click', function () { draw(d.parent); });
            list.appendChild(up);
          }

          d.dirs.forEach(function (x) {
            var b = D.el('button', { class: 'dirpick-row' });
            b.appendChild(D.el('span', { class: 'nm', text: x.name }));
            if (x.pipeline) {
              b.appendChild(D.el('span', { class: 'tag', text: '굽는 폴더' }));
            }
            b.addEventListener('click', function () { draw(x.path); });
            list.appendChild(b);
          });
        })
        .catch(function (e) { note.textContent = '서버가 없습니다: ' + e.message; });
    }
    draw(current || '');

    D.modal.open({
      title: title,
      body: body,
      buttons: [
        { label: '이 폴더 고르기', class: 'btn-primary', onClick: function () { onPick(at); } },
        { label: '취소' }
      ]
    });
  }

  /* 칸 + 찾기 버튼 한 줄 */
  function folderRow(value, placeholder, title, onSet) {
    var wrap = D.el('div', { class: 'dir-row' });
    var i = D.el('input', { class: 'input mono', value: value || '', placeholder: placeholder });
    var b = D.el('button', { class: 'btn btn-sm', text: '찾기' });
    i.addEventListener('change', function () { onSet(i.value.trim()); });
    b.addEventListener('click', function () {
      pickFolder(title, i.value.trim(), function (path) {
        i.value = path;
        onSet(path);
      });
    });
    wrap.appendChild(i);
    wrap.appendChild(b);
    return wrap;
  }

  function renderSetup() {
    var cfg = D.state.render;

    var dir = folderRow(cfg.dir, 'edit/고구마', '굽는 폴더 고르기', function (v) {
      cfg.dir = v;
      D.info('굽는 폴더: ' + (v || '(없음)'), 'render');
      D.touch();
      /* 폴더가 바뀌면 거기 있는 번역도 다른 것이다 */
      D.Editor.refreshTranslations().then(function () { render(); });
    });

    var out = folderRow(cfg.out, 'edited', '내보내기 폴더 고르기', function (v) {
      cfg.out = v;
      D.info('내보내기 폴더: ' + (v || '(스크립트에 적힌 자리)'), 'render');
      D.touch();
      render();
    });

    var base = D.el('input', { class: 'input', value: cfg.base || 'ko' });
    base.addEventListener('change', function () {
      cfg.base = base.value.trim() || 'ko';
      D.touch();
      render();
    });

    var langs = D.el('input', {
      class: 'input', value: (D.state.ai.langs || []).join(', '),
      placeholder: 'ko, en'
    });
    langs.addEventListener('change', function () {
      D.state.ai.langs = langText(langs.value);
      D.info('자막 언어: ' + (D.state.ai.langs.join(', ') || '원본 1종'), 'render');
      D.AI.refresh();
      D.touch();
      render();
    });

    var rec = D.Editor.renderRec();
    var go = D.el('button', {
      class: 'btn btn-primary', text: '렌더링',
      title: '서버가 이 자리에서 굽습니다 (컷이 그대로면 자막만 다시 굽습니다)'
    });
    go.disabled = !!(rec && rec.state === 'running');
    go.addEventListener('click', function () { D.Editor.doRender(); });

    box.appendChild(sec('폴더', [
      row('굽는 곳', dir),
      row('내보낼 곳', out),
      go
    ]));
    box.appendChild(sec('언어', [
      row('자막', langs),
      row('기준', base),
      planLine()
    ]));
    var prog = progressBox(rec);
    if (prog) box.appendChild(sec('진행', [prog]));
  }

  /* 고를 클립이 없으면 이 판은 클립 인스펙터가 아니라 내보내기 설정이다.
     그때까지 "클립 / 자막 전체"라고 적혀 있으면 지금 무엇을 보고 있는지
     알 수가 없다. */
  function setTabs(exporting) {
    var tabs = D.$$('.itab');
    if (!tabs.length) return;
    tabs[0].textContent = exporting ? '내보내기' : '클립';
    if (tabs[1]) tabs[1].hidden = exporting;
  }

  /* ==================== 렌더 ==================== */
  function render() {
    if (!box) return;
    var sel = D.TL.selected();
    box.innerHTML = '';

    if (!sel.length) {
      setTabs(true);
      tag.textContent = '';
      renderSetup();
      return;
    }
    setTabs(false);

    if (sel.length > 1) {
      tag.textContent = sel.length + '개 선택';
      var b = D.el('button', { class: 'btn btn-danger', text: '선택 클립 삭제' });
      b.addEventListener('click', function () { D.TL.deleteSelected(); });
      box.appendChild(sec(null, [
        D.el('p', { class: 'hint', text: '개별 속성은 하나만 선택했을 때 나옵니다.' }),
        b
      ]));
      return;
    }

    var c = sel[0];
    tag.textContent = D.KIND_LABEL[c.kind] + ' 클립';

    box.appendChild(clipStrip(c));

    if (c.kind === 'video') renderVideo(c);
    if (c.kind === 'audio' || c.kind === 'sfx') renderAudio(c);
    if (c.kind === 'caption') renderCaption(c);
  }

  /* ---------- 영상 ---------- */
  function renderVideo(c) {
    var loop = D.el('label', { class: 'chk' });
    var li = D.el('input', { type: 'checkbox' });
    li.checked = !!c.loop;
    li.addEventListener('change', function () {
      c.loop = li.checked;
      commit('되돌려 재생 ' + (c.loop ? '켬' : '끔') + ': ' + c.name);
    });
    loop.appendChild(li);
    loop.appendChild(D.el('span', { text: '소스 끝에서 처음으로 (배경용)' }));

    box.appendChild(sec('영상', [
      row('불투명도', range(Math.round(c.opacity * 100), 0, 100, 1, '%', function (v) {
        c.opacity = v / 100; D.emit('preview:refresh'); D.touch();
      })),
      row('볼륨', range(Math.round((c.volume === undefined ? 1 : c.volume) * 100), 0, 200, 1, '%', function (v) {
        c.volume = v / 100; D.emit('preview:refresh'); D.touch();
      })),
      loop
    ]));

    /* 화면 자리 - 완성본의 어디에 이 영상이 놓이는지. 영도 쇼츠는 배경이
       화면 전체, 도네 영상이 가운데 띠라서 이 값이 곧 디자인이다. 한 번
       맞추면 다시 안 보므로 접어 둔다. */
    var lay = D.state.layout || {};
    var cw = (lay.canvas && lay.canvas[0]) || 1080;
    var ch = (lay.canvas && lay.canvas[1]) || 1920;
    var fr = c.frame;
    var full = D.el('button', { class: 'btn btn-sm', text: fr ? '화면 전체로' : '자리 정하기' });
    full.addEventListener('click', function () {
      c.frame = fr ? null : { x: 0, y: 0, w: cw, h: ch };
      commit(fr ? '화면 자리 해제 (화면에 맞춤): ' + c.name : '화면 자리 지정: ' + c.name);
      render();
    });
    function fnum(k, label) {
      return row(label, num(fr[k], 1, function (v) {
        fr[k] = Math.round(v);
        commit('화면 자리 ' + label + ' ' + fr[k] + 'px');
      }));
    }
    /* 확대는 자리의 가운데를 붙잡고 키우거나 줄인다. 모서리를 끌어 맞추는
       것보다 이쪽이 정확할 때가 많다 (영도 쇼츠의 "약간의 확대"처럼). */
    function zoomBy(pct) {
      var f = c.frame;
      var nw = Math.max(8, Math.round(f.w * pct / 100));
      var nh = Math.max(8, Math.round(f.h * pct / 100));
      c.frame = {
        x: Math.round(f.x - (nw - f.w) / 2),
        y: Math.round(f.y - (nh - f.h) / 2),
        w: nw, h: nh
      };
      commit('확대 ' + pct + '% (' + nw + 'x' + nh + ')');
      render();
    }
    var zoomRow = D.el('div', { class: 'insp-grid2' });
    [90, 100, 110, 125].forEach(function (pv) {
      var b = D.el('button', { class: 'btn btn-sm', text: pv + '%' });
      b.addEventListener('click', function () { zoomBy(pv); });
      zoomRow.appendChild(b);
    });

    box.appendChild(fold('화면 자리 · ' + cw + 'x' + ch, fr ? [
      fnum('x', '왼쪽'), fnum('y', '위'), fnum('w', '너비'), fnum('h', '높이'),
      row('확대', zoomRow),
      full,
      D.el('p', { class: 'hint', text: '미리보기에서 상자를 끌어도 됩니다 (Shift 비율 유지).' })
    ] : [
      D.el('p', { class: 'hint', text: '자리를 정하지 않아 화면에 맞춰 넣습니다.' }),
      full
    ]));

    /* 크롭 - 소스의 어느 부분을 쓸지. 가장자리에서 잘라 내는 %로 적는다.
       ffmpeg의 crop= 과 같은 뜻이라 렌더로 그대로 옮겨진다. */
    var cr = c.crop || { x: 0, y: 0, w: 1, h: 1 };
    function edge(label, get, set) {
      return row(label, range(Math.round(get() * 1000) / 10, 0, 45, 0.5, '%', function (v) {
        set(v / 100);
        D.emit('preview:refresh'); D.touch();
      }));
    }
    var cropReset = D.el('button', { class: 'btn btn-sm', text: '크롭 해제' });
    cropReset.addEventListener('click', function () {
      c.crop = null; commit('크롭 해제: ' + c.name); render();
    });
    box.appendChild(fold('크롭', [
      edge('왼쪽', function () { return cr.x; },
        function (v) { var r = cr.x + cr.w; cr.x = Math.min(v, r - 0.05); cr.w = r - cr.x; c.crop = cr; }),
      edge('위', function () { return cr.y; },
        function (v) { var b = cr.y + cr.h; cr.y = Math.min(v, b - 0.05); cr.h = b - cr.y; c.crop = cr; }),
      edge('오른쪽', function () { return 1 - (cr.x + cr.w); },
        function (v) { cr.w = Math.max(0.05, 1 - v - cr.x); c.crop = cr; }),
      edge('아래', function () { return 1 - (cr.y + cr.h); },
        function (v) { cr.h = Math.max(0.05, 1 - v - cr.y); c.crop = cr; }),
      cropReset,
      D.el('p', { class: 'hint', text: '미리보기에서 Alt를 누른 채 끌면 보이는 부분만 밀립니다.' })
    ]));
  }

  /* ---------- 오디오 · 효과음 ---------- */
  function renderAudio(c) {
    var a = assetOf(c);
    box.appendChild(sec(c.kind === 'sfx' ? '효과음' : '오디오', [
      row('볼륨', range(Math.round(c.volume * 100), 0, 200, 1, '%', function (v) {
        c.volume = v / 100; D.emit('preview:refresh'); D.touch();
      })),
      row('소스', ro(a ? a.name : '(연결 없음)'))
    ]));
  }

  /* ---------- 자막 ---------- */
  function renderCaption(c) {
    var st = c.style || Object.assign({}, D.TL.captionStyle);
    c.style = st;

    /* 화자 */
    var speakers = {};
    E.clips.forEach(function (x) { if (x.kind === 'caption' && x.speaker) speakers[x.speaker] = 1; });
    var dl = D.el('datalist', { id: 'spk-list' });
    Object.keys(speakers).forEach(function (s) { dl.appendChild(D.el('option', { value: s })); });

    var spk = D.el('input', { class: 'input', value: c.speaker || '', list: 'spk-list', placeholder: '화자' });
    spk.addEventListener('change', function () {
      c.speaker = spk.value.trim();
      commit('화자 변경: ' + (c.speaker || '(없음)'));
    });

    var txt = D.el('textarea', { class: 'input', rows: 3, placeholder: '자막 내용' });
    txt.value = c.text || '';
    txt.addEventListener('input', function () {
      c.text = txt.value;
      c.name = txt.value.slice(0, 20) || '자막';   /* 로그가 이름을 쓴다 */
      D.emit('preview:refresh');
      var node = document.querySelector('.clip[data-id="' + c.id + '"] .clip-label');
      if (node) node.textContent = (c.speaker ? c.speaker + ' · ' : '') + (c.text || '(빈 자막)');
      D.touch();
    });
    txt.addEventListener('change', function () { D.info('자막 내용 수정: ' + D.fmtTime(c.start), 'caption'); });

    function go(dir) {
      var list = E.clips.filter(function (x) { return x.kind === 'caption'; })
        .sort(function (a, b) { return a.start - b.start; });
      var i = list.findIndex(function (x) { return x.id === c.id; });
      var n = list[i + dir];
      if (!n) { D.warn(dir > 0 ? '마지막 자막입니다.' : '첫 자막입니다.', 'caption'); return; }
      D.TL.select([n.id]);
      D.TL.setPlayhead(n.start + 0.01);
    }

    var head = D.el('div', { class: 'insp-sec-head' });
    head.appendChild(D.el('div', { class: 'insp-sec-title', text: '자막 내용' }));
    var nav = D.el('div', { class: 'insp-nav' });
    nav.appendChild(iconBtn('chev', '이전 자막', function () { go(-1); }));
    nav.appendChild(iconBtn('chev', '다음 자막', function () { go(1); }));
    nav.lastChild.classList.add('is-down');
    nav.firstChild.classList.add('is-up');
    head.appendChild(nav);

    var s1 = D.el('div', { class: 'insp-sec' });
    s1.appendChild(head);
    s1.appendChild(dl);
    s1.appendChild(row('화자', spk));
    s1.appendChild(txt);
    box.appendChild(s1);

    /* 디자인 */
    function upd(k, v, msg) { st[k] = v; D.emit('preview:refresh'); D.touch(); if (msg) D.info(msg, 'caption'); }

    /* 이 컴퓨터에 깔린 폰트 전부. 몇 개만 박아 두면 정작 쓰는 폰트가 없다. */
    var fontSel = D.Fonts.select(st.font, function (stack, name) {
      upd('font', stack, '자막 폰트: ' + name);
    });

    /* 발끈 자막. 완성본에서는 노랑->주황빨강 세로 그라데이션에 연두 그림자가
       깔린다. 한 영상에 한두 번 쓰는 것이라 스위치 하나로 둔다 - 색은 스타일
       분석에서 잰 값이라 손댈 일이 거의 없어 아래 접이식으로 내렸다. */
    var emphSeg = toggleSeg(
      [{ v: 'off', label: '보통' }, { v: 'on', label: '발끈' }],
      st.emphasis ? 'on' : 'off',
      function (v) {
        var on = v === 'on';
        /* 파이프라인은 화자 이름으로 발끈을 가린다 (speaker 가 "...발끈").
           style.emphasis 만 바꾸면 미리보기는 주황인데 CSV 로 나가는 화자는
           그대로라, 구워 놓고 보면 흰 자막이다. 둘을 같이 움직인다. */
        var base = String(c.speaker || '').replace(/발끈$/, '');
        c.speaker = on ? (base || '담유이') + '발끈' : base;
        upd('emphasis', on, '자막 ' + (on ? '발끈으로' : '보통으로')
          + ' (화자 ' + (c.speaker || '(없음)') + ')');
        D.TL.render();
        render();
      }
    );

    /* 열에 아홉은 이 다섯만 만진다 */
    box.appendChild(sec('디자인', [
      row('종류', emphSeg),
      row('폰트', fontSel),
      row('크기', range(st.size, 2, 16, 0.1, '%', function (v) { upd('size', v); })),
      st.emphasis ? null : row('글자색', color(st.color, function (v) { upd('color', v); })),
      row('세로 위치', range(st.posY, 0, 100, 0.5, '%', function (v) { upd('posY', v); }))
    ]));

    var noBg = D.el('button', { class: 'btn btn-sm', text: '배경 없음' });
    noBg.addEventListener('click', function () { upd('bg', 'transparent', '자막 배경 제거'); });

    var showSpk = D.el('label', { class: 'chk' });
    var si = D.el('input', { type: 'checkbox' });
    si.checked = !!st.showSpeaker;
    si.addEventListener('change', function () {
      upd('showSpeaker', si.checked, '화자 이름 표시 ' + (si.checked ? '켬' : '끔'));
    });
    showSpk.appendChild(si);
    showSpk.appendChild(D.el('span', { text: '화자 이름도 화면에 그리기' }));

    var applyAll = D.el('button', { class: 'btn btn-sm', text: '같은 화자 전체에 적용' });
    applyAll.addEventListener('click', function () {
      if (!c.speaker) { D.warn('화자가 비어 있어 일괄 적용할 수 없습니다.', 'caption'); return; }
      var n = 0;
      E.clips.forEach(function (x) {
        if (x.kind === 'caption' && x.speaker === c.speaker && x.id !== c.id) {
          x.style = Object.assign({}, st); n += 1;
        }
      });
      D.info('화자 "' + c.speaker + '" 자막 ' + n + '개에 디자인 적용', 'caption');
      D.emit('preview:refresh');
      D.touch();
    });

    if (st.emphasis) {
      box.appendChild(fold('발끈 색', [
        row('채움 위', color(st.emphTop || '#fbd65a', function (v) { upd('emphTop', v); })),
        row('채움 아래', color(st.emphBottom || '#fb5d4b', function (v) { upd('emphBottom', v); })),
        row('외곽선', color(st.emphOutline || '#1c2c38', function (v) { upd('emphOutline', v); })),
        row('그림자', color(st.emphShadow || '#dafd73', function (v) { upd('emphShadow', v); })),
        D.el('p', { class: 'hint', text: '완성본의 ASS Emph 스타일에서 잰 값입니다.' })
      ]));
    }

    box.appendChild(fold('테두리 · 배경 · 자리', [
      row('외곽선', color(st.outline, function (v) { upd('outline', v); })),
      row('외곽 두께', range(st.outlineWidth, 0, 30, 0.5, '', function (v) { upd('outlineWidth', v); })),
      row('그림자', range(st.shadowOff === undefined ? 7 : st.shadowOff, 0, 30, 1, '', function (v) { upd('shadowOff', v); })),
      row('배경', color(st.bg === 'transparent' ? '#000000' : st.bg, function (v) { upd('bg', v); })),
      noBg,
      row('가로 위치', range(st.posX === undefined ? 50 : st.posX, 0, 100, 0.5, '%', function (v) { upd('posX', v); })),
      row('두께', toggleSeg(
        [{ v: 'normal', label: '보통' }, { v: 'bold', label: '굵게' }],
        st.bold ? 'bold' : 'normal',
        function (v) { upd('bold', v === 'bold'); }
      )),
      row('정렬', toggleSeg(
        [{ v: 'left', label: '왼쪽' }, { v: 'center', label: '가운데' }, { v: 'right', label: '오른쪽' }],
        st.align, function (v) { upd('align', v); }
      )),
      showSpk,
      applyAll
    ]));
  }

  /* ==================== 전체 자막 ====================

     자막을 하나씩 골라 가며 고치면 앞뒤 흐름이 안 보인다. 같은 말이 두 번
     들어갔는지, 말이 겹치는지, 화자가 섞였는지는 나란히 놓고 봐야 보인다.
     그래서 자막만 따로 목록으로 놓고 그 자리에서 고치게 한다.
     상단 캡션도 자막 클립이므로 여기 같이 나온다. */

  function capsSorted() {
    return E.clips.filter(function (c) { return c.kind === 'caption'; })
      .sort(function (a, b) { return a.start - b.start || a.dur - b.dur; });
  }

  function isNow(c) {
    return E.playhead >= c.start && E.playhead < c.start + c.dur;
  }

  function subRow(c, trackName) {
    var r = D.el('div', {
      class: 'subrow' + (isNow(c) ? ' is-now' : '')
        + (E.selection.indexOf(c.id) !== -1 ? ' is-sel' : '')
        + (c.style && c.style.emphasis ? ' subrow-emph' : ''),
      title: trackName + '  ' + D.fmtTime(c.start) + ' ~ ' + D.fmtTime(c.start + c.dur)
    });

    var t = D.el('div', { class: 'subrow-t' });
    t.appendChild(D.el('div', { text: D.fmtTime(c.start).slice(2) }));
    t.appendChild(D.el('div', { text: D.fmtDur(c.dur) }));
    r.appendChild(t);

    var f = D.el('div', { class: 'subrow-f' });
    var spk = D.el('input', { class: 'subrow-spk', value: c.speaker || '', placeholder: '화자' });
    spk.addEventListener('change', function () {
      c.speaker = spk.value.trim();
      D.emit('preview:refresh');
      D.TL.render();
      D.TL.changed();
    });
    var txt = D.el('textarea', { class: 'subrow-txt', rows: 1, placeholder: '자막' });
    txt.value = c.text || '';
    function grow() { txt.style.height = 'auto'; txt.style.height = (txt.scrollHeight + 2) + 'px'; }
    txt.addEventListener('input', grow);
    txt.addEventListener('change', function () {
      c.text = txt.value;
      c.name = txt.value.slice(0, 20) || '자막';
      D.emit('preview:refresh');
      D.TL.render();
      D.TL.changed();
    });
    /* 한 줄을 다 고치면 다음 줄로 넘어가는 게 자연스럽다 */
    txt.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' || ev.shiftKey) return;
      ev.preventDefault();
      txt.blur();
      var all = D.$$('.subrow-txt', subsBox);
      var i = all.indexOf(txt);
      if (i >= 0 && all[i + 1]) all[i + 1].focus();
    });
    f.appendChild(spk);
    f.appendChild(txt);
    r.appendChild(f);

    /* 줄을 누르면 그 자막으로 간다 - 미리보기에서 바로 확인하려고 */
    r.addEventListener('mousedown', function (ev) {
      if (ev.target === spk || ev.target === txt) return;
      D.TL.setPlayhead(c.start + Math.min(0.1, c.dur / 2));
      D.TL.select([c.id]);
    });

    setTimeout(grow, 0);
    return r;
  }

  function renderSubs() {
    if (!subsBox) return;
    subsBox.innerHTML = '';
    var caps = capsSorted();
    var head = D.el('div', {
      class: 'subs-head',
      title: '줄을 누르면 그 자막으로 이동합니다 · Enter로 다음 줄'
    });
    head.appendChild(D.el('span', { text: '자막 ' + caps.length + '장' }));
    subsBox.appendChild(head);

    if (!caps.length) {
      subsBox.appendChild(D.el('div', {
        class: 'subs-empty',
        text: '자막 클립이 없습니다. T를 눌러 재생헤드에 자막을 추가하세요.'
      }));
      return;
    }

    var list = D.el('div', { class: 'subs-list' });
    var names = {};
    D.TL.tracks().forEach(function (t) { names[t.id] = t.name; });
    caps.forEach(function (c) { list.appendChild(subRow(c, names[c.trackId] || '')); });
    subsBox.appendChild(list);

    /* 지금 자막이 목록 밖에 있으면 끌어다 놓는다 */
    var now = list.querySelector('.subrow.is-now');
    if (now) {
      var lb = list.getBoundingClientRect(), nb = now.getBoundingClientRect();
      if (nb.top < lb.top || nb.bottom > lb.bottom) {
        list.scrollTop += nb.top - lb.top - lb.height / 3;
      }
    }
  }

  /* 재생헤드만 움직였을 때 목록을 통째로 다시 그리면 타이핑하던 칸이 날아간다.
     색깔만 바꾼다. */
  function markNow() {
    if (!subsBox || mode !== 'subs') return;
    var caps = capsSorted();
    var rows = D.$$('.subrow', subsBox);
    if (rows.length !== caps.length) { renderSubs(); return; }
    rows.forEach(function (r, i) {
      r.classList.toggle('is-now', isNow(caps[i]));
      r.classList.toggle('is-sel', E.selection.indexOf(caps[i].id) !== -1);
    });
  }

  function setMode(m) {
    mode = m;
    if (m === 'subs') setTabs(false);
    D.$$('.itab').forEach(function (b) { b.classList.toggle('is-active', b.dataset.itab === m); });
    box.hidden = m !== 'clip';
    subsBox.hidden = m !== 'subs';
    if (m === 'subs') renderSubs(); else render();
  }

  D.Inspector = {
    init: function () {
      box = D.$('#inspector');
      subsBox = D.$('#inspectorSubs');
      tag = D.$('#inspTag');
      D.$$('.itab').forEach(function (b) {
        b.addEventListener('click', function () { setMode(b.dataset.itab); });
      });
      D.on('selection:changed', function () { if (mode === 'subs') markNow(); else render(); });
      D.on('timeline:changed', function () { if (mode === 'subs') renderSubs(); else render(); });
      D.on('playhead', markNow);
      /* 굽는 동안 진행이 여기 뜬다. 선택이 없을 때만 그리므로 다른 화면을
         보고 있으면 방해하지 않는다. */
      D.on('render:tick', function () {
        if (mode !== 'subs' && !D.TL.selected().length) render();
      });
      render();
    },
    render: function () { if (mode === 'subs') renderSubs(); else render(); },
    setMode: setMode
  };

})(window.D);
