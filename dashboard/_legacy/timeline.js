/* ==========================================================================
   timeline.js - 트랙 / 클립 타임라인 (이동, 트리밍, 컷, 동기화, 스냅)
   ========================================================================== */
(function (D) {
  'use strict';

  var E = D.state.editor;
  var LANE_H = 55;           /* 높이 54 + 경계선 1 */
  var SNAP_PX = 8;
  var DRAG_MIN = 3;          /* 이만큼은 움직여야 끌기로 친다 (px) */
  var EDGE_PX = 44;          /* 가장자리 이 안으로 들어오면 저절로 밀린다 */
  var FRAME = 1 / 60;

  var elHeads, elLanes, elRuler, elInner, elScroll, elPlayhead, snapLine, markBand, marquee;

  /* ---------- 조회 ---------- */
  function track(id) { return E.tracks.filter(function (t) { return t.id === id; })[0]; }
  function clip(id) { return E.clips.filter(function (c) { return c.id === id; })[0]; }
  function clipsOf(tid) { return E.clips.filter(function (c) { return c.trackId === tid; }); }
  function selected() { return E.selection.map(clip).filter(Boolean); }

  function contentEnd() {
    return E.clips.reduce(function (m, c) { return Math.max(m, c.start + c.dur); }, 0);
  }
  function duration() {
    E.duration = Math.max(30, contentEnd() + 5);
    return E.duration;
  }

  /* ---------- 좌표 ---------- */
  function pps() { return E.pxPerSec; }
  function xOf(t) { return t * pps(); }
  function tOf(clientX) {
    var r = elLanes.getBoundingClientRect();
    return Math.max(0, (clientX - r.left) / pps());
  }

  /* ---------- 스냅 ---------- */
  /* 시간 값이 숫자가 아니면 그 클립은 자리를 잃는다. 게다가 저장할 때
     JSON이 NaN을 null로 바꿔 버려서, 다시 열어도 되살아나지 않는다.
     그래서 바깥에서 들어오는 값은 여기를 통과시킨다. */
  function num(v, dflt) {
    if (typeof v === 'string') v = parseFloat(v);
    return (typeof v === 'number' && isFinite(v)) ? v : dflt;
  }

  /* 이미 망가진 클립을 제자리로 돌린다. 예전 판이 남긴 null도 여기서 0이
     된다 - 프로젝트 파일을 손으로 고치게 하지 않는다. */
  function heal() {
    E.clips.forEach(function (c) {
      c.start = Math.max(0, num(c.start, 0));
      c.dur = Math.max(0.1, num(c.dur, 1));
      c.offset = Math.max(0, num(c.offset, 0));
      /* 자막 클립은 저마다 style 복사본을 들고 있다. 기본값을 고쳐도 이미
         저장된 프로젝트는 낡은 색을 그대로 쓰므로 여기서 옮겨 준다.
         (ASS BGR 을 안 뒤집어 짙은 갈색이 되어 있던 발끈 외곽선) */
      if (c.style && c.style.emphOutline === '#382c1c') c.style.emphOutline = '#1c2c38';
    });
  }

  function snapPoints(exclude) {
    var pts = [0, E.playhead];
    E.clips.forEach(function (c) {
      if (exclude && exclude.indexOf(c.id) !== -1) return;
      pts.push(c.start, c.start + c.dur);
    });
    return pts;
  }
  function snap(t, exclude) {
    if (!E.snap) return { t: t, hit: null };
    var tol = SNAP_PX / pps();
    var best = null, bd = tol;
    snapPoints(exclude).forEach(function (p) {
      var d = Math.abs(p - t);
      if (d < bd) { bd = d; best = p; }
    });
    return best === null ? { t: t, hit: null } : { t: best, hit: best };
  }
  function showSnap(t) {
    if (!snapLine) return;
    if (t === null || t === undefined) { snapLine.classList.remove('on'); return; }
    snapLine.style.left = xOf(t) + 'px';
    snapLine.classList.add('on');
  }

  /* ---------- 트랙 ---------- */
  function nextName(kind) {
    var n = E.tracks.filter(function (t) { return t.kind === kind; }).length + 1;
    return { video: '영상', audio: '오디오', caption: '자막', sfx: '효과음' }[kind] + ' ' + n;
  }

  function addTrack(kind, name, quiet) {
    var t = { id: D.uid('trk'), kind: kind, name: name || nextName(kind), muted: false, locked: false };
    if (kind === 'caption' || kind === 'video') E.tracks.unshift(t);
    else E.tracks.push(t);
    if (!quiet) D.info('트랙 추가: ' + t.name, 'edit');
    render();
    D.touch();
    return t;
  }

  function removeTrack(id) {
    var t = track(id);
    if (!t) return;
    var n = clipsOf(id).length;
    E.clips = E.clips.filter(function (c) { return c.trackId !== id; });
    E.tracks = E.tracks.filter(function (x) { return x.id !== id; });
    E.selection = E.selection.filter(function (cid) { return clip(cid); });
    D.warn('트랙 삭제: ' + t.name + (n ? ' (클립 ' + n + '개 함께 삭제)' : ''), 'edit');
    render();
    changed();
  }

  /* ---------- 클립 ---------- */
  /* 미리보기 자막의 기본값. 실제 렌더(ASS)와 같은 폰트 · 크기 · 위치를 쓴다.
     예전 기본값은 Pretendard 6.4% / 78%였는데, 렌더는 CookieRun 6.8% / 82%라
     대시보드에서 본 것과 나온 영상이 달랐다. 프로젝트를 불러오면 클립마다
     담긴 style이 이 값을 덮어쓴다. */
  var CAPTION_STYLE = {
    font: '"CookieRunOTF Black", "CookieRun Black", Pretendard, Malgun Gothic, sans-serif',
    size: 6.8,             /* 스테이지 높이 대비 % - ASS fontsize 130 / 1920 */
    color: '#ffffff',
    outline: '#181a20',
    outlineWidth: 3,       /* 완성본 캔버스 기준 (ASS Outline). 무대 크기에 맞춰 줄여 그린다 */
    shadow: '#17fff8',     /* 담유이 자막의 청록 그림자 */
    shadowOff: 7,          /* 그림자 거리 (ASS Shadow) */
    showSpeaker: false,    /* 화자 이름을 화면에도 그릴지. 담유이는 이름표가 없다 */
    posX: 50,              /* 가로 위치 % (가운데가 50) */
    bg: 'transparent',
    posY: 82,              /* 스테이지 상단 기준 % - MarginV 340 기준 */
    bold: true,
    italic: false,
    align: 'center',
    /* 발끈(emphasis) 자막. 완성본의 ASS Emph 스타일에서 그대로 가져온 값이다.
         Style: Emph,CookieRunOTF Black,130,&H005AD6FB,...,&H00382C1C,&H0073FDDA,
                ...,1,7,6,...
       ASS 는 색을 &H00BBGGRR& 로 적으므로 바이트를 뒤집어야 RGB 가 된다.
       외곽선만 뒤집지 않고 &H00382C1C 를 #382c1c 로 베껴 놓아서 미리보기가
       짙은 갈색으로 나왔다 - 완성본은 짙은 청회색 #1C2C38 이다.
       채움은 위 #FBD65A(노랑) -> 아래 #FB5D4B(주황빨강), 그림자는 연두
       #DAFD73 이다. 연두를 채움 맨 위 색으로 읽었던 적이 있는데, 크게 확대해
       보면 글자 안이 아니라 아래 가장자리에 깔려 있다 (build_ass.py 참고). */
    emphasis: false,
    emphTop: '#fbd65a',        /* &H005AD6FB */
    emphBottom: '#fb5d4b',
    emphOutline: '#1c2c38',    /* &H00382C1C - 뒤집어야 한다 */
    emphOutlineWidth: 7,       /* ASS Outline */
    emphShadow: '#dafd73',     /* &H0073FDDA - 연두 그림자 */
    emphShadowOff: 6           /* ASS Shadow */
  };

  function addClip(c) {
    var t = track(c.trackId);
    if (!t) { D.error('클립을 추가할 트랙이 없습니다.', 'edit'); return null; }
    var nc = {
      id: D.uid('clip'),
      trackId: c.trackId,
      kind: t.kind,
      name: c.name || '클립',
      assetId: c.assetId || null,
      groupId: c.groupId || null,
      start: Math.max(0, c.start || 0),
      dur: Math.max(0.1, c.dur || 3),
      offset: c.offset || 0,
      srcDur: c.srcDur || null,
      volume: c.volume === undefined ? 1 : c.volume,
      opacity: c.opacity === undefined ? 1 : c.opacity,
      /* 이 영상이 완성본의 어디에 놓이는지 (캔버스 픽셀). 없으면 화면에
         꽉 채운다. 영도 쇼츠는 배경이 화면 전체, 도네 영상이 가운데 띠다. */
      frame: c.frame || null,
      /* 소스의 어느 부분을 쓸지 (0~1 비율). 없으면 전체 */
      crop: c.crop || null,
      /* 배경처럼 짧은 소스를 계속 돌려 쓰는 클립 */
      loop: !!c.loop,
      speaker: c.speaker || '',
      text: c.text || '',
      style: t.kind === 'caption' ? Object.assign({}, CAPTION_STYLE, c.style || {}) : (c.style || null)
    };
    E.clips.push(nc);
    return nc;
  }

  function removeClips(ids) {
    E.clips = E.clips.filter(function (c) { return ids.indexOf(c.id) === -1; });
    E.selection = E.selection.filter(function (id) { return ids.indexOf(id) === -1; });
  }

  /* 동기화 대상: 같은 groupId 클립 */
  function groupPeers(c) {
    if (!E.sync || !c.groupId) return [c];
    return E.clips.filter(function (x) { return x.groupId === c.groupId; });
  }

  function moveSet(base) {
    /* 선택 + (동기화 시) 그룹 동료 */
    var set = {};
    base.forEach(function (c) {
      groupPeers(c).forEach(function (p) { set[p.id] = p; });
    });
    return Object.keys(set).map(function (k) { return set[k]; });
  }

  /* ---------- 컷 ---------- */
  /* 컷은 전 트랙에 걸린다.

     예전에는 고른 클립이 있으면 그것만 잘랐다. 그런데 영상만 골라 두고 컷을
     누르면 영상은 잘리고 오디오 · 자막 · 배경은 그대로라, 뒤를 앞으로 당기는
     순간 소리와 그림이 어긋난다. NLE의 면도날이 그렇듯 재생헤드가 지나는
     모든 트랙을 함께 자른다 - 잠긴 트랙만 빼고.

     한 트랙만 자르고 싶으면 그 트랙을 빼고 나머지를 잠그면 된다. */
  function splitAt(t, onlySelected) {
    var targets = (onlySelected && selected().length ? moveSet(selected()) : E.clips)
      .filter(function (c) {
        var tr = track(c.trackId);
        return tr && !tr.locked && c.start < t - 0.001 && c.start + c.dur > t + 0.001;
      });
    if (!targets.length) { D.warn('재생헤드 ' + D.fmtTime(t) + ' 위치에 자를 클립이 없습니다.', 'cut'); return; }

    var gmap = {};
    var newIds = [];
    targets.forEach(function (c) {
      var rightDur = (c.start + c.dur) - t;
      var gid = null;
      if (c.groupId) {
        if (!gmap[c.groupId]) gmap[c.groupId] = D.uid('grp');
        gid = gmap[c.groupId];
      }
      var nc = addClip({
        trackId: c.trackId, name: c.name, assetId: c.assetId, groupId: gid,
        start: t, dur: rightDur, offset: c.offset + (t - c.start), srcDur: c.srcDur,
        volume: c.volume, opacity: c.opacity,
        /* 화면 자리 · 크롭 · 돌려 쓰기까지 물려준다. 안 물려주면 자른 순간
           뒤쪽 반이 화면 전체로 튀어나온다. */
        frame: c.frame ? Object.assign({}, c.frame) : null,
        crop: c.crop ? Object.assign({}, c.crop) : null,
        loop: c.loop,
        speaker: c.speaker, text: c.text,
        style: c.style ? Object.assign({}, c.style) : null
      });
      c.dur = t - c.start;
      newIds.push(nc.id);
    });
    var trs = {};
    targets.forEach(function (c) { trs[c.trackId] = 1; });
    D.info('컷: ' + D.fmtTime(t) + ' 에서 클립 ' + targets.length + '개 분할 (트랙 '
      + Object.keys(trs).length + '개)', 'cut');
    E.selection = newIds;
    render();
    changed();
  }

  function deleteSelected() {
    /* 지우고 나면 그 구간은 이미 없다 */
    E.markIn = null; E.markOut = null;
    var sel = selected();
    if (!sel.length) { D.warn('삭제할 클립이 선택되지 않았습니다.', 'edit'); return; }
    var ids = moveSet(sel).map(function (c) { return c.id; });
    D.warn('클립 삭제 ' + ids.length + '개', 'edit');
    removeClips(ids);
    render();
    changed();
  }

  /* ---------- 인 · 아웃 점 ----------

     i 로 잘라낼 구간의 앞을, o 로 뒤를 찍는다. 둘 다 그 자리에서 전 트랙을
     자르므로, o 를 찍고 나면 두 점 사이가 통째로 떨어져 나온 상태가 된다.
     그 조각들을 골라 두기까지 하니 Delete 한 번이면 구간이 사라진다.
     (지우고 앞으로 당기는 것은 지금처럼 손으로 끈다 - 자동으로 당기면
     동기화 그룹이 아닌 클립까지 끌려간다) */
  function setMark(which, t) {
    t = D.round(D.clamp(t, 0, duration()), 3);
    splitAt(t);                                   /* 찍는 자리에서 전 트랙 컷 */
    E[which] = t;
    /* 앞뒤가 뒤집히면 반대쪽은 버린다 - 남겨 두면 빈 구간이 칠해진다 */
    if (E.markIn !== null && E.markOut !== null && E.markOut <= E.markIn) {
      E[which === 'markIn' ? 'markOut' : 'markIn'] = null;
    }
    paintMarks();
    if (E.markIn !== null && E.markOut !== null) {
      var inside = E.clips.filter(function (c) {
        var tr = track(c.trackId);
        return tr && !tr.locked
          && c.start >= E.markIn - 0.002 && c.start + c.dur <= E.markOut + 0.002;
      });
      select(inside.map(function (c) { return c.id; }));
      D.info('구간 ' + D.fmtTime(E.markIn) + ' ~ ' + D.fmtTime(E.markOut)
        + ' (' + D.fmtDur(E.markOut - E.markIn) + ') 클립 ' + inside.length
        + '개 선택 - Delete 로 지웁니다', 'cut');
    } else {
      D.info((which === 'markIn' ? '컷 시작(i)' : '컷 끝(o)') + ': ' + D.fmtTime(t), 'cut');
    }
    changed();
  }

  function clearMarks() {
    E.markIn = null; E.markOut = null;
    paintMarks();
    D.info('구간 표시를 지웠습니다.', 'cut');
  }

  function paintMarks() {
    if (!elInner) return;
    if (!markBand) {
      markBand = D.el('div', { class: 'markband' });
      elInner.appendChild(markBand);
    }
    elInner.appendChild(markBand);               /* 언제나 맨 위로 */
    var a = E.markIn, b = E.markOut;
    if (a === null && b === null) { markBand.style.display = 'none'; return; }
    markBand.style.display = 'block';
    markBand.className = 'markband'
      + (a === null ? ' no-in' : '') + (b === null ? ' no-out' : '');
    var x0 = xOf(a === null ? 0 : a);
    var x1 = xOf(b === null ? (a === null ? 0 : a) : b);
    markBand.style.left = x0 + 'px';
    markBand.style.width = Math.max(0, x1 - x0) + 'px';
  }

  /* ---------- 선택 ---------- */
  function select(ids, additive) {
    if (!Array.isArray(ids)) ids = ids ? [ids] : [];
    E.selection = additive ? E.selection.concat(ids.filter(function (i) { return E.selection.indexOf(i) === -1; })) : ids;
    paintSelection();
    D.emit('selection:changed', E.selection);
  }

  function paintSelection() {
    D.$$('.clip', elLanes).forEach(function (n) {
      n.classList.toggle('is-sel', E.selection.indexOf(n.dataset.id) !== -1);
    });
    D.$$('.tl-head-row', elHeads).forEach(function (n) {
      var has = selected().some(function (c) { return c.trackId === n.dataset.id; });
      n.classList.toggle('is-sel', has);
    });
  }

  /* ---------- 재생헤드 ----------

     재생하면 재생선이 오른쪽 끝을 넘어가고, 그때부터는 무엇이 재생되고
     있는지 화면으로 볼 수가 없다. 선이 화면 밖으로 나가면 왼쪽 20% 자리로
     끌어다 놓는다 - 지나간 것도 조금 보이고 앞으로 올 것이 넉넉히 보인다.
     화면 안에 있는 동안은 건드리지 않는다 (스크럽할 때 화면이 튀지 않게). */
  var FOLLOW_AT = 0.2;

  function followPlayhead() {
    if (!elScroll) return;
    var view = elScroll.clientWidth;
    var max = elScroll.scrollWidth - view;
    if (max <= 0 || view <= 0) return;
    var x = xOf(E.playhead);
    var left = elScroll.scrollLeft;
    /* 오른쪽은 조금 일찍(24px) 넘긴다. 선이 딱 가장자리에 붙어 지워지는
       것처럼 보이는 걸 막는다. */
    if (x >= left + 2 && x <= left + view - 24) return;
    elScroll.scrollLeft = D.clamp(x - view * FOLLOW_AT, 0, max);
  }

  /* quiet: 이벤트를 내지 않는다 (재생 중 매 프레임)
     noFollow: 스크롤을 건드리지 않는다 (다시 그리기 · 확대처럼 부르는 쪽이
     스크롤을 직접 맞추는 경우. 이게 없으면 확대할 때 화면이 두 번 튄다) */
  function setPlayhead(t, quiet, noFollow) {
    E.playhead = D.clamp(t, 0, duration());
    if (elPlayhead) elPlayhead.style.left = xOf(E.playhead) + 'px';
    D.$$('[data-tc-now]').forEach(function (n) { n.textContent = D.fmtTime(E.playhead); });
    if (!noFollow) followPlayhead();
    if (!quiet) D.emit('playhead', E.playhead);
  }

  /* ---------- 렌더 ---------- */
  function renderRuler() {
    var pxs = pps(), dur = duration();
    var steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    var step = steps.filter(function (s) { return s * pxs >= 64; })[0] || 900;
    elRuler.innerHTML = '';
    var frag = document.createDocumentFragment();
    for (var t = 0; t <= dur + step; t += step) {
      var tick = D.el('div', { class: 'tl-tick major' });
      tick.style.left = xOf(t) + 'px';
      tick.appendChild(D.el('span', { text: step >= 1 ? D.fmtTime(t).replace(/\.\d+$/, '') : t.toFixed(1) + 's' }));
      frag.appendChild(tick);
    }
    elRuler.appendChild(frag);
    elRuler.style.width = xOf(dur + step) + 'px';
  }

  function headRow(t) {
    var row = D.el('div', { class: 'tl-head-row k-' + t.kind, 'data-id': t.id });
    row.appendChild(D.icon(D.KIND_ICON[t.kind]));
    var name = D.el('span', { class: 'tname', text: t.name, title: t.name });
    name.addEventListener('dblclick', function () {
      var v = prompt('트랙 이름', t.name);
      if (v !== null) { t.name = v.trim() || t.name; render(); D.touch(); }
    });
    row.appendChild(name);

    var btns = D.el('div', { class: 'tbtns' });
    var mute = D.el('button', { class: 'tb' + (t.muted ? ' is-on' : ''), title: t.kind === 'video' ? '숨김' : '음소거' });
    mute.appendChild(D.icon(t.kind === 'video' || t.kind === 'caption' ? 'eye' : (t.muted ? 'mute' : 'audio')));
    mute.addEventListener('click', function () {
      t.muted = !t.muted;
      D.info('트랙 ' + t.name + ' ' + (t.muted ? '끔' : '켬'), 'edit');
      render(); changed();
    });
    var lock = D.el('button', { class: 'tb' + (t.locked ? ' is-on' : ''), title: '잠금' });
    lock.appendChild(D.icon('lock'));
    lock.addEventListener('click', function () {
      t.locked = !t.locked;
      D.info('트랙 ' + t.name + ' ' + (t.locked ? '잠금' : '잠금 해제'), 'edit');
      render(); D.touch();
    });
    var rm = D.el('button', { class: 'tb rm', title: '트랙 삭제' });
    rm.appendChild(D.icon('trash'));
    rm.addEventListener('click', function () { removeTrack(t.id); });
    btns.appendChild(mute); btns.appendChild(lock); btns.appendChild(rm);
    row.appendChild(btns);
    return row;
  }

  function clipEl(c) {
    var n = D.el('div', { class: 'clip k-' + c.kind + (c.groupId ? ' is-grouped' : ''), 'data-id': c.id });
    n.style.left = xOf(c.start) + 'px';
    n.style.width = Math.max(6, xOf(c.dur)) + 'px';
    n.appendChild(D.el('div', { class: 'clip-label', text: c.kind === 'caption' ? (c.speaker ? c.speaker + ' · ' : '') + (c.text || '(빈 자막)') : c.name }));
    n.appendChild(D.el('div', { class: 'clip-sub', text: D.fmtDur(c.dur) + (c.kind === 'caption' ? '' : '  ' + D.fmtTime(c.start)) }));
    if (c.kind === 'audio' || c.kind === 'sfx') n.appendChild(D.el('div', { class: 'clip-wave' }));
    n.appendChild(D.el('div', { class: 'grip l' }));
    n.appendChild(D.el('div', { class: 'grip r' }));
    return n;
  }

  function render() {
    if (!elLanes) return;
    heal();
    var dur = duration();
    var w = Math.max(xOf(dur) + 200, elScroll ? elScroll.clientWidth : 800);

    elHeads.innerHTML = '';
    elHeads.appendChild(D.el('div', { class: 'tl-heads-pad' }));
    elLanes.innerHTML = '';

    /* 트랙이 몇 개 안 되면 위쪽에 몰려 붙고 아래가 텅 빈다. 남는 높이를
       반으로 갈라 트랙 묶음을 가운데 놓는다. 이름표와 레인이 같은 값을
       써야 줄이 맞으므로 CSS 변수 하나로 둘에 같이 먹인다. */
    var body = D.$('#tlBody');
    if (body && elScroll) {
      var avail = elScroll.clientHeight - 26;            /* 26 = 눈금자 */
      var used = E.tracks.length * LANE_H;
      var vpad = Math.max(0, Math.floor((avail - used) / 2));
      body.style.setProperty('--tl-vpad', vpad + 'px');
      elHeads.appendChild(D.el('div', { class: 'tl-heads-gap' }));
    }

    E.tracks.forEach(function (t) {
      elHeads.appendChild(headRow(t));
      var lane = D.el('div', { class: 'tl-lane k-' + t.kind + (t.locked ? ' is-locked' : ''), 'data-id': t.id });
      lane.style.width = w + 'px';
      clipsOf(t.id).forEach(function (c) { lane.appendChild(clipEl(c)); });
      elLanes.appendChild(lane);
    });

    if (!E.tracks.length) {
      elLanes.appendChild(D.el('div', { class: 'empty-note', text: '트랙이 없습니다. 트랙 추가를 누르세요.' }));
    }

    elInner.style.width = w + 'px';
    renderRuler();
    setPlayhead(E.playhead, true, true);
    paintSelection();
    D.$('#tcTotal').textContent = D.fmtTime(contentEnd());
    if (!snapLine) {
      snapLine = D.el('div', { class: 'snapline' });
      elInner.appendChild(snapLine);
    } else elInner.appendChild(snapLine);
    paintMarks();
  }

  /* 같은 트랙에서 클립이 겹치면 알린다 (막지는 않는다) */
  function warnOverlap(trackIds) {
    (trackIds || E.tracks.map(function (t) { return t.id; })).forEach(function (tid) {
      var list = clipsOf(tid).slice().sort(function (a, b) { return a.start - b.start; });
      for (var i = 1; i < list.length; i++) {
        if (list[i].start < list[i - 1].start + list[i - 1].dur - 0.001) {
          D.warn('트랙 "' + track(tid).name + '"에서 클립이 겹칩니다: ' +
            D.fmtTime(list[i].start) + ' 부근', 'edit');
          return;
        }
      }
    });
  }

  function selectAll() {
    var ids = E.clips.map(function (c) { return c.id; });
    select(ids);
  }

  /* ---------- 되돌리기 ----------

     타임라인이 바뀌기 직전의 모습을 쌓아 둔다. changed()는 이미 모든 편집
     끝에서 불리므로, 여기서 "직전 상태"를 밀어 넣으면 따로 챙길 곳이 없다.
     클립과 트랙만 담는다 - 재생헤드나 확대율까지 되돌리면 되돌리기가 화면을
     엉뚱한 데로 튕겨 보내서 오히려 헷갈린다. */
  var past = [], future = [], lastSnap = null, restoring = false;
  var HISTORY_MAX = 60;

  /* 되돌리기용 스냅샷. 이름이 snap이면 위의 자석 붙기 snap(t, exclude)과
     같은 스코프에서 부딪친다 - 뒤에 선언한 이쪽이 이겨서, 클립을 끌면
     자리 계산 대신 JSON 문자열이 돌아오고 start가 NaN이 됐다. */
  function histSnap() {
    return JSON.stringify({
      tracks: E.tracks,
      clips: E.clips.map(function (c) {
        var o = {}; Object.keys(c).forEach(function (k) { if (k !== 'el') o[k] = c[k]; });
        return o;
      }),
      selection: E.selection
    });
  }

  function restore(str) {
    var d = JSON.parse(str);
    E.tracks = d.tracks;
    E.clips = d.clips;
    E.selection = d.selection || [];
    restoring = true;
    render();
    D.emit('timeline:changed');
    D.emit('selection:changed', E.selection);
    D.touch();
    restoring = false;
    lastSnap = histSnap();
    /* 되돌리면 i · o 로 찍었던 컷이 사라졌을 수 있다. 없는 자리를 가리키는
       띠가 남아 있으면 엉뚱한 구간을 지운다. */
    E.markIn = null; E.markOut = null;
    paintMarks();
  }

  function undo() {
    if (!past.length) { D.info('되돌릴 것이 없습니다.', 'edit'); return; }
    future.push(lastSnap || histSnap());
    restore(past.pop());
    D.info('되돌렸습니다. (남은 되돌리기 ' + past.length + '회)', 'edit');
  }

  function redo() {
    if (!future.length) { D.info('다시 할 것이 없습니다.', 'edit'); return; }
    past.push(lastSnap || histSnap());
    restore(future.pop());
    D.info('다시 했습니다. (남은 다시하기 ' + future.length + '회)', 'edit');
  }

  function changed() {
    if (!restoring) {
      if (lastSnap !== null) {
        past.push(lastSnap);
        if (past.length > HISTORY_MAX) past.shift();
        future.length = 0;          // 새로 편집하면 다시하기 줄기는 버린다
      }
      lastSnap = histSnap();
    }
    D.emit('timeline:changed');
    D.emit('selection:changed', E.selection);
    D.touch();
  }

  /* 불러오기 · 초기화처럼 통째로 바뀐 뒤에는 이전 기록이 의미가 없다 */
  function resetHistory() {
    past.length = 0; future.length = 0; lastSnap = histSnap();
  }

  /* ---------- 포인터 상호작용 ---------- */
  function laneAt(clientY) {
    var lanes = D.$$('.tl-lane', elLanes);
    for (var i = 0; i < lanes.length; i++) {
      var r = lanes[i].getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return lanes[i];
    }
    return null;
  }

  /* 빈 자리를 끌면 사각형을 그려 그 안에 걸친 클립을 전부 고른다 (목록에서
     드래그로 여러 줄을 고르는 것과 같다). Shift · Ctrl 을 누른 채 끌면
     이미 고른 것에 보탠다. 움직이지 않고 놓으면 예전처럼 선택을 비우고
     재생헤드만 옮긴다. */
  function startMarquee(ev) {
    var additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
    var base = additive ? E.selection.slice() : [];
    var x0 = ev.clientX, y0 = ev.clientY;
    var scroll0 = elScroll.scrollLeft, top0 = elScroll.scrollTop;
    var moved = false;

    if (!marquee) marquee = D.el('div', { class: 'marquee' });
    elInner.appendChild(marquee);                 /* 언제나 맨 위로 */

    function apply(e) {
      if (!moved && Math.abs(e.clientX - x0) < DRAG_MIN && Math.abs(e.clientY - y0) < DRAG_MIN) return;
      moved = true;

      /* 끄는 동안 타임라인이 밀렸으면(가장자리 자동 밀기 · 휠) 시작점도 그만큼
         따라가야 한다. 화면 좌표만 보면 사각형이 손에서 미끄러진다. */
      var sx = x0 + (scroll0 - elScroll.scrollLeft);
      var sy = y0 + (top0 - elScroll.scrollTop);
      var cl = Math.min(sx, e.clientX), cr = Math.max(sx, e.clientX);
      var ct = Math.min(sy, e.clientY), cb = Math.max(sy, e.clientY);

      /* 보이는 사각형은 elInner 안에 그린다 (눈금자 높이만큼 위에서 시작한다) */
      var ib = elInner.getBoundingClientRect();
      marquee.style.display = 'block';
      marquee.style.left = (cl - ib.left) + 'px';
      marquee.style.top = (ct - ib.top) + 'px';
      marquee.style.width = (cr - cl) + 'px';
      marquee.style.height = (cb - ct) + 'px';

      /* 어느 트랙에 걸쳤는지는 레인의 실제 자리로 판단한다. 높이를 계산으로
         맞추면 가운데 배치(--tl-vpad)만큼 한 칸씩 밀린다. */
      var lb = elLanes.getBoundingClientRect();
      var t0 = (cl - lb.left) / pps(), t1 = (cr - lb.left) / pps();
      var hit = [];
      D.$$('.tl-lane', elLanes).forEach(function (laneEl) {
        var r = laneEl.getBoundingClientRect();
        if (r.bottom < ct || r.top > cb) return;
        var tr = track(laneEl.dataset.id);
        if (!tr || tr.locked) return;
        clipsOf(tr.id).forEach(function (c) {
          /* 스치기만 해도 고른다 - 통째로 감싸게 하면 긴 클립을 못 잡는다 */
          if (c.start < t1 && c.start + c.dur > t0) hit.push(c.id);
        });
      });
      select(base.concat(hit.filter(function (id) { return base.indexOf(id) === -1; })));
    }

    function up(e) {
      window.removeEventListener('pointermove', apply);
      window.removeEventListener('pointerup', up);
      if (marquee) marquee.style.display = 'none';
      if (!moved) { select([]); setPlayhead(tOf(e.clientX)); }
      else D.info('클립 ' + E.selection.length + '개 선택', 'edit');
    }
    window.addEventListener('pointermove', apply);
    window.addEventListener('pointerup', up);
  }

  function bindLanes() {
    /* 레인이 아니라 안쪽 상자 전체가 듣는다. 트랙이 몇 개 안 되면 위아래로
       빈 자리가 넓게 남는데(가운데 배치), 거기서는 아무 일도 안 일어나
       클릭이 먹히지 않는 것처럼 보였다. 빈 자리도 타임라인이다 - 누르면
       재생선이 그 자리로 가고 선택이 풀린다 (startMarquee 의 "안 움직이고
       놓았을 때"와 같은 길). */
    elInner.addEventListener('pointerdown', function (ev) {
      if (ev.target.closest('.tl-ruler')) return;      /* 눈금자는 스크럽이다 */
      var clipNode = ev.target.closest('.clip');
      if (!clipNode) { startMarquee(ev); ev.preventDefault(); return; }
      var c = clip(clipNode.dataset.id);
      if (!c) return;
      var t = track(c.trackId);
      if (t.locked) { D.warn('잠긴 트랙의 클립은 편집할 수 없습니다: ' + t.name, 'edit'); return; }

      var additive = ev.shiftKey || ev.ctrlKey;
      if (E.selection.indexOf(c.id) === -1) select([c.id], additive);
      else if (additive) {
        // 골라 둔 것을 빼려고 누른 것이다. 여기서 끌기까지 시작하면 뺀 김에
        // 나머지 클립이 딸려 움직인다.
        select(E.selection.filter(function (i) { return i !== c.id; }));
        ev.preventDefault();
        return;
      }

      /* 좁은 클립은 양쪽 손잡이만으로 꽉 차서 옮길 자리가 없어진다.
         그럴 땐 손잡이를 무시하고 옮기기로 친다 - 길이는 인스펙터에서 고친다. */
      var grip = clipNode.offsetWidth >= 26 ? ev.target.closest('.grip') : null;
      var mode = grip ? (grip.classList.contains('l') ? 'trim-l' : 'trim-r') : 'move';
      startDrag(ev, c, mode);
      ev.preventDefault();
    });

    /* 룰러 드래그 = 스크럽 */
    elRuler.addEventListener('pointerdown', function (ev) {
      elRuler.setPointerCapture(ev.pointerId);
      setPlayhead(tOf(ev.clientX));
      function mv(e) { setPlayhead(tOf(e.clientX)); }
      function up() {
        elRuler.removeEventListener('pointermove', mv);
        elRuler.removeEventListener('pointerup', up);
      }
      elRuler.addEventListener('pointermove', mv);
      elRuler.addEventListener('pointerup', up);
    });
  }

  function startDrag(ev, c, mode) {
    var startX = ev.clientX, startY = ev.clientY;
    var moving = moveSet(selected().length ? selected() : [c]);
    var origin = moving.map(function (m) { return { c: m, start: m.start, dur: m.dur, offset: m.offset, trackId: m.trackId }; });
    var anchor = { start: c.start, dur: c.dur, offset: c.offset };
    var ids = moving.map(function (m) { return m.id; });
    var moved = false;
    var targetLaneId = null;
    var startScroll = elScroll.scrollLeft;
    var lastEv = null, edgeTimer = null;

    D.$$('.clip', elLanes).forEach(function (n) {
      if (ids.indexOf(n.dataset.id) !== -1) n.classList.add('is-drag');
    });

    function apply(e) {
      lastEv = e;
      /* 손이 떨린 정도로는 움직이지 않는다. 고르려고 누른 것을 옮긴 것으로
         치면 클립이 조금씩 밀린다. */
      if (!moved && Math.abs(e.clientX - startX) < DRAG_MIN
                 && Math.abs(e.clientY - startY) < DRAG_MIN) return;
      /* 끄는 동안 타임라인이 옆으로 밀렸으면(가장자리 자동 밀기, 휠) 그만큼도
         움직인 것이다. 화면 좌표만 보면 클립이 손에서 미끄러진다. */
      var dx = ((e.clientX - startX) + (elScroll.scrollLeft - startScroll)) / pps();

      if (mode === 'move') {
        var want = anchor.start + dx;
        var s = snap(want, ids);
        showSnap(s.hit);
        var delta = s.t - anchor.start;
        var minStart = origin.reduce(function (m, o) { return Math.min(m, o.start); }, Infinity);
        if (minStart + delta < 0) delta = -minStart;
        origin.forEach(function (o) { o.c.start = D.round(o.start + delta, 3); });

        /* 세로 이동: 같은 종류의 다른 트랙으로 */
        var lane = laneAt(e.clientY);
        if (lane && Math.abs(e.clientY - startY) > LANE_H * 0.5) {
          var tt = track(lane.dataset.id);
          if (tt && !tt.locked && tt.kind === c.kind && tt.id !== c.trackId) targetLaneId = tt.id;
          else targetLaneId = null;
        } else targetLaneId = null;
        D.$$('.tl-lane', elLanes).forEach(function (l) { l.classList.toggle('is-drop', targetLaneId === l.dataset.id); });

      } else if (mode === 'trim-l') {
        var ws = snap(anchor.start + dx, ids);
        showSnap(ws.hit);
        var maxStart = anchor.start + anchor.dur - 0.1;
        var ns = D.clamp(ws.t, 0, maxStart);
        var d = ns - anchor.start;
        origin.forEach(function (o) {
          o.c.start = D.round(o.start + d, 3);
          o.c.dur = D.round(o.dur - d, 3);
          o.c.offset = D.round(Math.max(0, o.offset + d), 3);
        });
      } else {
        var we = snap(anchor.start + anchor.dur + dx, ids);
        showSnap(we.hit);
        var nd = Math.max(0.1, we.t - anchor.start);
        var dd = nd - anchor.dur;
        origin.forEach(function (o) { o.c.dur = D.round(Math.max(0.1, o.dur + dd), 3); });
      }

      moved = true;
      /* 위치만 갱신 */
      origin.forEach(function (o) {
        var n = elLanes.querySelector('.clip[data-id="' + o.c.id + '"]');
        if (!n) return;
        n.style.left = xOf(o.c.start) + 'px';
        n.style.width = Math.max(6, xOf(o.c.dur)) + 'px';
        var sub = n.querySelector('.clip-sub');
        if (sub) sub.textContent = D.fmtDur(o.c.dur) + (o.c.kind === 'caption' ? '' : '  ' + D.fmtTime(o.c.start));
      });
    }

    /* 타임라인은 보이는 것보다 훨씬 길다. 가장자리에 닿았을 때 저절로
       밀어 주지 않으면 먼 자리로는 아예 옮길 수가 없다. */
    function edgeScroll() {
      if (!lastEv || !moved) return;
      var r = elScroll.getBoundingClientRect();
      var v = 0;
      if (lastEv.clientX < r.left + EDGE_PX) v = lastEv.clientX - (r.left + EDGE_PX);
      else if (lastEv.clientX > r.right - EDGE_PX) v = lastEv.clientX - (r.right - EDGE_PX);
      if (!v) return;
      var max = elScroll.scrollWidth - elScroll.clientWidth;
      var before = elScroll.scrollLeft;
      elScroll.scrollLeft = D.clamp(before + D.clamp(v, -EDGE_PX, EDGE_PX) * 0.5, 0, max);
      if (elScroll.scrollLeft !== before) apply(lastEv);
    }
    edgeTimer = setInterval(edgeScroll, 16);

    function up() {
      clearInterval(edgeTimer);
      window.removeEventListener('pointermove', apply);
      window.removeEventListener('pointerup', up);
      showSnap(null);
      D.$$('.tl-lane', elLanes).forEach(function (l) { l.classList.remove('is-drop'); });

      if (targetLaneId) {
        origin.forEach(function (o) { if (o.c.kind === c.kind) o.c.trackId = targetLaneId; });
        D.info('클립을 트랙 "' + track(targetLaneId).name + '"으로 이동', 'edit');
      }
      if (moved) {
        var label = mode === 'move' ? '이동' : '트리밍';
        D.info('클립 ' + label + ': ' + c.name + ' → ' + D.fmtTime(c.start) + ' (' + D.fmtDur(c.dur) + ')' +
          (E.sync && c.groupId ? ' · 동기화 그룹 ' + origin.length + '개' : ''), 'edit');
        warnOverlap(origin.map(function (o) { return o.c.trackId; })
          .filter(function (v, i, a) { return a.indexOf(v) === i; }));
      }
      render();
      changed();
    }

    window.addEventListener('pointermove', apply);
    window.addEventListener('pointerup', up);
  }

  /* ---------- 초기 트랙 ---------- */
  function ensureDefaults() {
    if (E.tracks.length) return;
    addTrack('video', '영상 1', true);
    addTrack('audio', '오디오 1', true);
    D.info('기본 트랙 구성: 영상 1, 오디오 1', 'edit');
  }

  /* ---------- 휠 ----------

     타임라인은 가로로 긴 것이라 휠도 가로로 도는 게 맞다. 세로로 돌면 트랙이
     몇 개 안 될 때는 아무 일도 일어나지 않고, 편집하는 동안 계속 보고 있어야
     하는 건 시간축이다.

       휠            가로 이동
       Shift + 휠    세로 이동 (트랙이 많을 때)
       Ctrl + 휠     확대 · 축소. 마우스 밑의 시각을 붙잡고 늘린다

     터치패드의 가로 제스처(deltaX)는 그대로 흘려보낸다. */
  function bindWheel() {
    elScroll.addEventListener('wheel', function (ev) {
      /* 줄 단위 · 페이지 단위로 오는 휠도 있다 */
      var unit = ev.deltaMode === 1 ? 16 : (ev.deltaMode === 2 ? elScroll.clientHeight : 1);
      var dy = ev.deltaY * unit;
      var dx = ev.deltaX * unit;

      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        var r = elScroll.getBoundingClientRect();
        var atX = ev.clientX - r.left;                  /* 화면 안 위치 */
        var t = (elScroll.scrollLeft + atX) / pps();    /* 그 자리의 시각 */
        var next = D.clamp(pps() * (dy > 0 ? 0.88 : 1.136), 5, 500);
        if (Math.abs(next - pps()) < 0.01) return;
        E.pxPerSec = next;
        render();
        elScroll.scrollLeft = Math.max(0, xOf(t) - atX);
        var z = D.$('#zoom');
        if (z) z.value = E.pxPerSec;
        D.touch();
        return;
      }

      if (ev.shiftKey) return;                          /* 세로는 기본 동작에 맡긴다 */

      if (dx === 0 && dy === 0) return;
      var max = elScroll.scrollWidth - elScroll.clientWidth;
      if (max <= 0) return;
      var before = elScroll.scrollLeft;
      var after = D.clamp(before + (dx || dy), 0, max);
      if (after === before) return;                     /* 끝에 닿았으면 페이지에 넘긴다 */
      ev.preventDefault();
      elScroll.scrollLeft = after;
    }, { passive: false });
  }

  /* ---------- 공개 API ---------- */
  D.TL = {
    init: function () {
      elHeads = D.$('#tlHeads');
      elLanes = D.$('#tlLanes');
      elRuler = D.$('#tlRuler');
      elInner = D.$('#tlInner');
      elScroll = D.$('#tlScroll');
      elPlayhead = D.$('#playhead');

      elScroll.addEventListener('scroll', function () { elHeads.scrollTop = elScroll.scrollTop; });
      bindWheel();
      bindLanes();
      ensureDefaults();
      render();
    },
    render: render,
    changed: changed,
    addTrack: addTrack,
    removeTrack: removeTrack,
    addClip: addClip,
    removeClips: removeClips,
    splitAt: splitAt,
    setMark: setMark,
    clearMarks: clearMarks,
    deleteSelected: deleteSelected,
    select: select,
    selectAll: selectAll,
    undo: undo,
    redo: redo,
    resetHistory: resetHistory,
    selected: selected,
    clip: clip,
    track: track,
    clipsOf: clipsOf,
    tracks: function () { return E.tracks; },
    setPlayhead: setPlayhead,
    duration: duration,
    contentEnd: contentEnd,
    timeAt: tOf,
    laneAt: laneAt,
    frame: FRAME,
    captionStyle: CAPTION_STYLE,
    setZoom: function (v) {
      E.pxPerSec = D.clamp(v, 5, 500);
      render();
      D.touch();
    }
  };

})(window.D);
