/* ==========================================================================
   editor.js - 사용자 편집 탭 (선택 / 미리보기 / CSV / 렌더 작업)
   ========================================================================== */
(function (D) {
  'use strict';

  var E = D.state.editor;
  var stage, stageEmpty, subLayer, vidLayer, hitLayer;
  var audioPool = Object.create(null);
  /* 태그를 클립마다 두면 컷 경계를 넘을 때마다 <video>를 버리고 새로 만든다.
     같은 파일인데도 처음부터 다시 읽고 다시 찾아가야 해서, 자른 자리 뒤로는
     1초 넘게 화면이 빈다 (47.94초 이후가 이랬다). 트랙 + 소스로 묶어 두면
     이어 붙은 클립이 같은 태그를 쓰고 시각만 옮기면 된다. */
  var vidPool = Object.create(null);      /* 트랙+소스 하나에 video 태그 하나 */
  function poolKey(c) { return c.trackId + '|' + (c.assetId || 'none'); }
  var playing = false, rafId = null, lastTs = 0;
  var curVideoClipId = null;

  /* =================== 애셋 =================== */
  /* 프로젝트를 불러오면 애셋에 경로만 남고 파일은 없다 - 브라우저가 경로만으로
     파일을 열 수 없기 때문이다. 로컬 서버가 붙어 있으면 그 경로를 서버에
     물어서 미리보기를 살린다. 서버가 없으면 예전처럼 파일을 끌어다 놓아야
     한다. */
  function assetUrl(a) {
    if (a._url) return a._url;
    var f = D.files[a.fid];
    if (f) {
      a._url = URL.createObjectURL(f);
      return a._url;
    }
    if (a.path && D.Server && D.Server.online) {
      a._url = '/api/file?path=' + encodeURIComponent(a.path);
      return a._url;
    }
    return null;
  }

  function probe(a) {
    var url = assetUrl(a);
    if (!url || (a.kind !== 'video' && a.kind !== 'audio')) return Promise.resolve(a);
    return new Promise(function (res) {
      var m = document.createElement(a.kind === 'video' ? 'video' : 'audio');
      m.preload = 'metadata';
      m.onloadedmetadata = function () {
        a.duration = D.round(m.duration || 0, 3);
        res(a);
      };
      m.onerror = function () {
        D.warn('길이를 읽지 못했습니다: ' + a.name, 'asset');
        res(a);
      };
      m.src = url;
    });
  }

  function addNodes(nodes, opt) {
    opt = opt || {};
    var files = D.flatten(nodes);
    if (!files.length) { D.warn('추가할 파일이 없습니다.', 'asset'); return Promise.resolve([]); }

    var added = [];
    files.forEach(function (n) {
      if (E.assets.some(function (a) { return a.path === n.path && a.size === n.size; })) return;
      var a = {
        id: D.uid('as'), fid: n.fid, kind: n.kind, name: n.name, path: n.path,
        size: n.size, duration: null, rows: null
      };
      E.assets.push(a);
      added.push(a);
    });

    D.info('선택 목록에 ' + added.length + '개 추가 (영상 ' +
      added.filter(function (a) { return a.kind === 'video'; }).length + ', 오디오 ' +
      added.filter(function (a) { return a.kind === 'audio'; }).length + ', 자막 ' +
      added.filter(function (a) { return a.kind === 'caption'; }).length + ')', 'asset');

    renderBin();
    return Promise.all(added.map(probe)).then(function () {
      renderBin();
      D.touch();
      if (opt.then) opt.then(added);
      return added;
    });
  }

  /* =================== 선택(빈) UI =================== */
  function renderBin() {
    var wrap = D.$('#binGroups');
    wrap.innerHTML = '';
    var groups = { video: [], audio: [], caption: [], other: [] };
    E.assets.forEach(function (a) { (groups[a.kind] || groups.other).push(a); });

    Object.keys(groups).forEach(function (kind) {
      var list = groups[kind];
      if (!list.length) return;
      var g = D.el('div', { class: 'bin-group' });
      var title = D.el('div', { class: 'bin-group-title' });
      title.appendChild(D.icon(D.KIND_ICON[kind]));
      title.appendChild(D.el('span', { text: D.KIND_LABEL[kind] }));
      title.appendChild(D.el('span', { class: 'cnt', text: list.length }));
      g.appendChild(title);

      list.forEach(function (a) {
        var it = D.el('div', { class: 'bin-item k-' + a.kind, draggable: 'true', title: a.path });
        it.appendChild(D.icon(D.KIND_ICON[a.kind]));
        it.appendChild(D.el('span', { class: 'name', text: a.name }));
        it.appendChild(D.el('span', {
          class: 'meta',
          text: a.duration ? D.fmtDur(a.duration) : (a.rows ? a.rows.length + '행' : D.fmtBytes(a.size))
        }));
        var rm = D.el('button', { class: 'rm', title: '제거' });
        rm.appendChild(D.icon('x'));
        rm.addEventListener('click', function (ev) {
          ev.stopPropagation();
          E.assets = E.assets.filter(function (x) { return x.id !== a.id; });
          D.warn('선택 목록에서 제거: ' + a.name, 'asset');
          renderBin(); D.touch();
        });
        it.appendChild(rm);

        it.addEventListener('dragstart', function (ev) {
          ev.dataTransfer.setData('text/x-asset-id', a.id);
          ev.dataTransfer.effectAllowed = 'copy';
          it.classList.add('is-dragging');
        });
        it.addEventListener('dragend', function () { it.classList.remove('is-dragging'); });
        it.addEventListener('dblclick', function () { placeAsset(a, null, E.playhead); });
        g.appendChild(it);
      });
      wrap.appendChild(g);
    });

    if (!E.assets.length) {
      wrap.appendChild(D.el('p', { class: 'empty-note', text: '아직 선택된 파일이 없습니다.' }));
    }
  }

  /* =================== 타임라인 배치 =================== */
  function firstTrack(kind) {
    return D.TL.tracks().filter(function (t) { return t.kind === kind && !t.locked; })[0] || D.TL.addTrack(kind);
  }

  function placeAsset(a, trackId, at) {
    at = Math.max(0, at || 0);

    if (a.kind === 'caption') { importCsvAsset(a); return; }

    if (a.kind === 'video') {
      var vt = trackId && D.TL.track(trackId) && D.TL.track(trackId).kind === 'video' ? D.TL.track(trackId) : firstTrack('video');
      var at2 = at;
      var gid = D.uid('grp');
      var dur = a.duration || 5;
      D.TL.addClip({ trackId: vt.id, name: a.name, assetId: a.id, start: at2, dur: dur, groupId: gid, srcDur: a.duration });
      var au = firstTrack('audio');
      D.TL.addClip({ trackId: au.id, name: a.name + ' (오디오)', assetId: a.id, start: at2, dur: dur, groupId: gid, srcDur: a.duration });
      D.info('영상 배치: ' + a.name + ' @ ' + D.fmtTime(at2) + ' (' + D.fmtDur(dur) + ') · 영상 + 오디오 동기화 그룹', 'edit');
      D.TL.render(); D.TL.changed();
      return;
    }

    if (a.kind === 'audio') {
      var tt = trackId && D.TL.track(trackId) && (D.TL.track(trackId).kind === 'audio' || D.TL.track(trackId).kind === 'sfx')
        ? D.TL.track(trackId) : firstTrack('audio');
      D.TL.addClip({ trackId: tt.id, name: a.name, assetId: a.id, start: at, dur: a.duration || 3, srcDur: a.duration });
      D.info('오디오 배치: ' + a.name + ' @ ' + D.fmtTime(at) + ' (' + tt.name + ')', 'edit');
      D.TL.render(); D.TL.changed();
      return;
    }

    D.warn('타임라인에 놓을 수 없는 형식입니다: ' + a.name, 'edit');
  }

  /* =================== CSV =================== */
  function captionTracks() {
    return D.TL.tracks().filter(function (t) { return t.kind === 'caption'; });
  }

  /* 재생헤드에 자막 한 장을 새로 놓는다. CSV로 통째로 들여오는 길만 있어서
     한 줄 고치거나 보태려면 CSV를 편집해 다시 열어야 했다. */
  function addCaptionAtPlayhead() {
    var t = firstTrack('caption');
    var start = D.round(E.playhead, 3);
    var others = D.TL.clipsOf(t.id)
      .filter(function (c) { return c.start > start; })
      .sort(function (a, b) { return a.start - b.start; });
    var room = others.length ? others[0].start - start : 1.6;
    var overlap = D.TL.clipsOf(t.id).filter(function (c) {
      return start >= c.start && start < c.start + c.dur;
    })[0];
    if (overlap) {
      D.warn('재생헤드에 이미 자막이 있습니다. 그 자막을 고르거나 재생헤드를 옮기세요.', 'caption');
      D.TL.select([overlap.id]);
      return;
    }
    var c = D.TL.addClip({
      trackId: t.id, name: '자막', start: start,
      dur: Math.max(0.3, Math.min(1.6, room - 0.02)),
      speaker: '담유이', text: ''
    });
    if (!c) return;
    D.TL.render();
    D.TL.select([c.id]);
    D.TL.changed();
    D.info('자막을 추가했습니다 (' + D.fmtTime(c.start) + '). 인스펙터에서 내용을 적으세요.', 'caption');
  }

  /* 클립 복사 · 붙여넣기.

     클립보드는 대시보드 안에만 둔다. 시스템 클립보드에 실으면 다른 프로그램의
     복사와 뒤엉키고, 클립에 담긴 트랙 · 묶음 정보를 텍스트로 옮길 방법도 없다.
     여러 개를 복사하면 서로의 간격을 그대로 두고, 붙여넣을 때 그 덩어리의
     맨 앞을 재생헤드에 맞춘다. */
  var clipboard = [];

  function snapshot(c) {
    return {
      trackId: c.trackId, kind: c.kind, name: c.name, assetId: c.assetId,
      groupId: c.groupId, start: c.start, dur: c.dur, offset: c.offset,
      srcDur: c.srcDur, volume: c.volume, opacity: c.opacity,
      speaker: c.speaker, text: c.text,
      style: c.style ? JSON.parse(JSON.stringify(c.style)) : null
    };
  }

  function copySelected() {
    var sel = D.TL.selected();
    if (!sel.length) { D.warn('복사할 클립을 먼저 고르세요.', 'edit'); return; }
    var want = {};
    sel.forEach(function (c) {
      want[c.id] = c;
      if (c.groupId) {
        E.clips.forEach(function (x) { if (x.groupId === c.groupId) want[x.id] = x; });
      }
    });
    clipboard = Object.keys(want).map(function (k) { return snapshot(want[k]); });
    D.info('클립 ' + clipboard.length + '개를 복사했습니다. Ctrl+V로 재생헤드에 붙여넣습니다.', 'edit');
    D.toast('클립 ' + clipboard.length + '개 복사됨');
  }

  function pasteAtPlayhead() {
    if (!clipboard.length) { D.warn('복사한 클립이 없습니다. 먼저 Ctrl+C로 복사하세요.', 'edit'); return; }
    var base = clipboard.reduce(function (m, c) { return Math.min(m, c.start); }, Infinity);
    var at = D.round(E.playhead, 3);
    var newGroup = {};
    var made = [];
    var moved = 0;
    clipboard.forEach(function (c) {
      var trk = D.TL.track(c.trackId);
      if (!trk) { trk = firstTrack(c.kind); moved += 1; }
      var gid = null;
      if (c.groupId) {
        if (!newGroup[c.groupId]) newGroup[c.groupId] = D.uid('grp');
        gid = newGroup[c.groupId];
      }
      var n = D.TL.addClip({
        trackId: trk.id, name: c.name, assetId: c.assetId, groupId: gid,
        start: D.round(at + (c.start - base), 3), dur: c.dur, offset: c.offset,
        srcDur: c.srcDur, volume: c.volume, opacity: c.opacity,
        speaker: c.speaker, text: c.text,
        style: c.style ? JSON.parse(JSON.stringify(c.style)) : null
      });
      if (n) made.push(n.id);
    });
    D.TL.render();
    D.TL.select(made);
    D.TL.changed();
    D.info('클립 ' + made.length + '개를 ' + D.fmtTime(at) + '에 붙여넣었습니다.'
      + (moved ? ' (없어진 트랙 ' + moved + '개는 같은 종류의 첫 트랙으로 갔습니다)' : ''), 'edit');
  }

  /* 고른 클립을 그 뒤에 그대로 하나 더 놓는다. 영상·오디오처럼 묶인 클립은
     묶음째 복제하고 새 묶음 번호를 준다 - 안 그러면 원본과 사본이 같이 움직인다. */
  function duplicateSelected() {
    var sel = D.TL.selected();
    if (!sel.length) { D.warn('복제할 클립을 먼저 고르세요.', 'edit'); return; }
    var want = {};
    sel.forEach(function (c) {
      want[c.id] = c;
      if (c.groupId) {
        E.clips.forEach(function (x) { if (x.groupId === c.groupId) want[x.id] = x; });
      }
    });
    var list = Object.keys(want).map(function (k) { return want[k]; });
    var end = list.reduce(function (m, c) { return Math.max(m, c.start + c.dur); }, 0);
    var min = list.reduce(function (m, c) { return Math.min(m, c.start); }, Infinity);
    var shift = D.round(end - min, 3);
    var newGroup = {};
    var made = [];
    list.forEach(function (c) {
      var gid = null;
      if (c.groupId) {
        if (!newGroup[c.groupId]) newGroup[c.groupId] = D.uid('grp');
        gid = newGroup[c.groupId];
      }
      var n = D.TL.addClip({
        trackId: c.trackId, name: c.name, assetId: c.assetId, groupId: gid,
        start: D.round(c.start + shift, 3), dur: c.dur, offset: c.offset,
        srcDur: c.srcDur, volume: c.volume, opacity: c.opacity,
        speaker: c.speaker, text: c.text,
        style: c.style ? JSON.parse(JSON.stringify(c.style)) : null
      });
      if (n) made.push(n.id);
    });
    D.TL.render();
    D.TL.select(made);
    D.TL.changed();
    D.info('클립 ' + made.length + '개를 복제했습니다 (뒤로 ' + shift.toFixed(2) + '초).', 'edit');
  }

  function rowsToClips(rows, trackId) {
    rows.forEach(function (r) {
      D.TL.addClip({
        trackId: trackId, name: '자막', start: r.start, dur: Math.max(0.1, r.end - r.start),
        speaker: r.speaker, text: r.text
      });
    });
  }

  function importRows(rows, mode, trackId, srcName) {
    var tid = trackId;
    if (mode === 'new' || !tid) {
      var t = D.TL.addTrack('caption', '자막 (' + (srcName || 'CSV') + ')', true);
      tid = t.id;
    }

    if (mode === 'replace') {
      var old = D.TL.clipsOf(tid);
      D.TL.removeClips(old.map(function (c) { return c.id; }));
      rowsToClips(rows, tid);
      D.info('CSV 반영(교체): ' + rows.length + '행 · 기존 ' + old.length + '개 클립 제거', 'csv');
    } else if (mode === 'merge') {
      var existing = D.TL.clipsOf(tid).slice().sort(function (a, b) { return a.start - b.start; });
      var used = {}, upd = 0, add = 0, moved = 0;
      rows.forEach(function (r) {
        var hit = null, bd = 0.35;
        existing.forEach(function (c) {
          if (used[c.id]) return;
          var d = Math.abs(c.start - r.start);
          if (d < bd) { bd = d; hit = c; }
        });
        if (hit) {
          used[hit.id] = 1;
          if (hit.text !== r.text || hit.speaker !== r.speaker) upd += 1;
          if (Math.abs(hit.start - r.start) > 0.001 || Math.abs(hit.dur - (r.end - r.start)) > 0.001) moved += 1;
          hit.text = r.text; hit.speaker = r.speaker;
          hit.name = (r.text || '').slice(0, 20) || '자막';
          hit.start = r.start; hit.dur = Math.max(0.1, r.end - r.start);
        } else {
          D.TL.addClip({ trackId: tid, name: '자막', start: r.start, dur: Math.max(0.1, r.end - r.start), speaker: r.speaker, text: r.text });
          add += 1;
        }
      });
      var orphan = existing.filter(function (c) { return !used[c.id]; });
      D.info('CSV 수정 반영: 갱신 ' + upd + '개, 시간 변경 ' + moved + '개, 신규 ' + add + '개', 'csv');
      if (orphan.length) D.warn('CSV에 없는 기존 자막 ' + orphan.length + '개는 그대로 두었습니다.', 'csv');
    } else {
      rowsToClips(rows, tid);
      D.info('CSV 불러오기: ' + rows.length + '행을 새 자막 트랙에 추가', 'csv');
    }

    D.TL.render();
    D.TL.changed();
  }

  function importCsvText(text, srcName) {
    var res = D.CSV.parseSubtitles(text);
    if (!res.rows.length) { D.error('CSV에서 자막 행을 찾지 못했습니다: ' + srcName, 'csv'); return; }
    res.warnings.slice(0, 5).forEach(function (w) { D.warn(w, 'csv'); });
    if (res.warnings.length > 5) D.warn('그 외 경고 ' + (res.warnings.length - 5) + '건', 'csv');

    var tracks = captionTracks();
    var body = D.el('div', {});
    body.appendChild(D.el('p', {
      class: 'hint',
      text: srcName + ' · ' + res.rows.length + '행 (' + D.fmtTime(res.rows[0].start) + ' ~ ' +
        D.fmtTime(res.rows[res.rows.length - 1].end) + ')'
    }));

    var modeSel = D.el('select', { class: 'input' });
    modeSel.appendChild(D.el('option', { value: 'new', text: '새 자막 트랙으로 열기' }));
    if (tracks.length) {
      modeSel.appendChild(D.el('option', { value: 'merge', text: '수정 내용 반영 (시간 기준 매칭)' }));
      modeSel.appendChild(D.el('option', { value: 'replace', text: '선택 트랙 통째로 교체' }));
    }
    var trackSel = D.el('select', { class: 'input' });
    tracks.forEach(function (t) { trackSel.appendChild(D.el('option', { value: t.id, text: t.name })); });
    trackSel.disabled = true;
    modeSel.addEventListener('change', function () { trackSel.disabled = modeSel.value === 'new'; });

    var f1 = D.el('div', { class: 'field' });
    f1.appendChild(D.el('label', { class: 'field-label', text: '반영 방식' }));
    f1.appendChild(modeSel);
    var f2 = D.el('div', { class: 'field' });
    f2.appendChild(D.el('label', { class: 'field-label', text: '대상 트랙' }));
    f2.appendChild(trackSel);
    body.appendChild(f1);
    if (tracks.length) body.appendChild(f2);

    var pre = D.el('pre', {
      text: res.rows.slice(0, 12).map(function (r) {
        return D.fmtTime(r.start) + '  ' + D.fmtTime(r.end) + '  ' + (r.speaker || '-') + '  ' + r.text;
      }).join('\n') + (res.rows.length > 12 ? '\n... 외 ' + (res.rows.length - 12) + '행' : '')
    });
    body.appendChild(pre);

    D.modal.open({
      title: '자막 CSV 열기',
      body: body,
      buttons: [
        {
          label: '반영', class: 'btn-primary', onClick: function () {
            importRows(res.rows, modeSel.value, modeSel.value === 'new' ? null : trackSel.value, srcName);
          }
        },
        { label: '취소' }
      ]
    });
  }

  function importCsvAsset(a) {
    var f = D.files[a.fid];
    if (!f) { D.error('원본 파일이 없습니다. 다시 드랍하세요: ' + a.name, 'csv'); return; }
    D.readText(f).then(function (t) {
      a.rows = D.CSV.parseSubtitles(t).rows;
      renderBin();
      importCsvText(t, a.name);
    }).catch(function (e) { D.error('CSV 읽기 실패: ' + e.message, 'csv'); });
  }

  /* =================== 미리보기 =================== */
  function activeClips(kind) {
    var t = E.playhead;
    return E.clips.filter(function (c) {
      var tr = D.TL.track(c.trackId);
      return tr && !tr.muted && c.kind === kind && t >= c.start && t < c.start + c.dur;
    });
  }

  /* 트랙 순서가 곧 앞뒤다. 트랙 목록의 위가 앞에 온다(NLE와 같다).
     맨 앞 영상은 "지금 무엇을 보고 있나"를 판단할 때 쓴다. */
  function trackOrder() {
    return D.TL.tracks().map(function (t) { return t.id; });
  }

  function topVideoClip() {
    var list = activeClips('video');
    if (!list.length) return null;
    var order = trackOrder();
    list.sort(function (a, b) { return order.indexOf(a.trackId) - order.indexOf(b.trackId); });
    return list[0];
  }

  function assetOf(c) {
    return E.assets.filter(function (x) { return x.id === c.assetId; })[0] || null;
  }

  function srcTime(c) {
    var t = c.offset + (E.playhead - c.start);
    /* 배경처럼 돌려 쓰는 클립은 소스 끝에 닿으면 처음으로 돌아간다.
       렌더도 -stream_loop 로 같은 짓을 한다. */
    if (c.loop && c.srcDur > 0.1) t = t % c.srcDur;
    return Math.max(0, t);
  }

  function canvasSize() {
    var lay = D.state.layout || {};
    return [(lay.canvas && lay.canvas[0]) || 1080, (lay.canvas && lay.canvas[1]) || 1920];
  }

  /* 크롭은 소스의 어느 부분을 쓸지다. 0~1 비율로 적는다 (왼쪽 x, 위 y, 너비 w,
     높이 h). 없으면 전체를 쓴다. ffmpeg의 crop= 과 같은 뜻이라 렌더로 그대로
     옮길 수 있다. */
  function cropOf(c) {
    var r = c.crop;
    if (!r) return null;
    var x = D.clamp(r.x || 0, 0, 0.999), y = D.clamp(r.y || 0, 0, 0.999);
    var w = D.clamp(r.w === undefined ? 1 : r.w, 0.001, 1 - x);
    var h = D.clamp(r.h === undefined ? 1 : r.h, 0.001, 1 - y);
    if (x === 0 && y === 0 && w === 1 && h === 1) return null;
    return { x: x, y: y, w: w, h: h };
  }

  /* 클립이 완성본의 어디에 놓이는지. frame이 없으면 화면에 맞춰 넣는다.
     크롭이 있으면 자리(wrap)는 그대로 두고 그 안에서 영상을 키워 밀어 넣는다 -
     잘라낸 부분이 자리를 꽉 채우게 된다. */
  function placeFrame(wrap, el, frame, crop) {
    var cs = canvasSize(), cw = cs[0], ch = cs[1];
    if (frame) {
      wrap.style.left = (frame.x / cw * 100) + '%';
      wrap.style.top = (frame.y / ch * 100) + '%';
      wrap.style.width = (frame.w / cw * 100) + '%';
      wrap.style.height = (frame.h / ch * 100) + '%';
    } else {
      wrap.style.left = '0'; wrap.style.top = '0';
      wrap.style.width = '100%'; wrap.style.height = '100%';
    }
    if (crop) {
      el.style.left = (-crop.x / crop.w * 100) + '%';
      el.style.top = (-crop.y / crop.h * 100) + '%';
      el.style.width = (100 / crop.w) + '%';
      el.style.height = (100 / crop.h) + '%';
      el.style.objectFit = 'fill';
    } else {
      el.style.left = '0'; el.style.top = '0';
      el.style.width = '100%'; el.style.height = '100%';
      el.style.objectFit = frame ? 'fill' : 'contain';   /* 렌더도 띠 크기로 늘린다 */
    }
  }

  /* 이 영상 클립의 소리를 오디오 트랙이 대신 내주는가.
     같은 그룹 · 같은 소스의 오디오 클립이 있으면 그쪽이 낸다. */
  function hasOwnAudioTrack(c) {
    return E.clips.some(function (x) {
      return (x.kind === 'audio' || x.kind === 'sfx')
        && x.assetId === c.assetId && x.groupId && x.groupId === c.groupId;
    });
  }

  /* 편집에 있는 영상 클립을 전부 겹쳐 놓는다. 예전에는 video 태그가 하나뿐이라
     맨 앞 클립만 보였고, 배경과 띠는 레이아웃 설정으로 흉내 냈다. 그러면 배경이
     편집 대상이 아니게 되어 손댈 수가 없다. 이제 배경도 그냥 영상 클립이다. */
  function syncVideos() {
    var list = activeClips('video');
    var order = trackOrder();
    /* 뒤 트랙부터 깔고 앞 트랙을 위에 올린다 */
    list.sort(function (a, b) { return order.indexOf(b.trackId) - order.indexOf(a.trackId); });

    var want = {};
    var missing = null;
    list.forEach(function (c, i) {
      var a = assetOf(c);
      var url = a ? assetUrl(a) : null;
      if (!url) { if (!missing) missing = { clip: c, asset: a }; return; }
      var key = poolKey(c);
      want[key] = 1;
      /* 정지 그림도 영상 트랙에 놓인다 (롱폼 인용 카드의 LongBG 배경).
         <video>로는 그림을 못 그리므로 <img>로 만든다 - 그 뒤의 자리잡기와
         크롭은 둘 다 똑같이 먹는다. */
      var isImg = (a.kind === 'image')
        || /\.(jpe?g|png|webp|gif|bmp)$/i.test(a.path || a.name || '');
      var el = vidPool[key];
      if (el && (el.tagName === 'IMG') !== isImg) {     /* 종류가 바뀌었다 */
        el._wrap.remove(); delete vidPool[key]; el = null;
      }
      if (!el) {
        var wrap = document.createElement('div');
        wrap.className = 'vid-box';
        el = document.createElement(isImg ? 'img' : 'video');
        if (!isImg) {
          el.playsInline = true;
          el.preload = 'auto';
        }
        el.addEventListener('error', function () {
          D.error((isImg ? '그림을 열 수 없습니다: ' : '영상을 재생할 수 없습니다: ')
            + c.name, 'preview');
        });
        wrap.appendChild(el);
        el._wrap = wrap;
        vidPool[key] = el;
        vidLayer.appendChild(wrap);
      }
      el._clipId = c.id;
      el._wrap.style.zIndex = String(i + 1);
      el._wrap.dataset.clipId = c.id;
      if (!isImg) el.loop = !!c.loop;
      placeFrame(el._wrap, el, c.frame, cropOf(c));
      el._wrap.style.opacity = c.opacity;
      if (el.dataset.url !== url) { el.dataset.url = url; el.src = url; }
      if (isImg) return;                 /* 그림에는 시각도 소리도 없다 */

      /* 소리는 오디오 트랙이 낸다. 짝이 없는 영상만 스스로 낸다 - 그래야
         오디오 트랙을 음소거해 소리를 끌 수 있다. 배경처럼 볼륨 0으로 깔린
         영상은 소리를 내면 안 된다(렌더에서도 배경 소리는 안 들어간다). */
      el.volume = D.clamp(c.volume === undefined ? 1 : c.volume, 0, 1);
      el.muted = !D.$('#chkPreviewAudio').checked || hasOwnAudioTrack(c) || !el.volume;

      var w = srcTime(c);
      if (Math.abs(el.currentTime - w) > 0.25 || !playing) {
        try { el.currentTime = w; } catch (e) { /* 아직 로드 전 */ }
      }
      if (playing && el.paused) el.play().catch(function () { });
      if (!playing && !el.paused) el.pause();
    });

    Object.keys(vidPool).forEach(function (k) {
      if (want[k]) return;
      vidPool[k].pause();
      (vidPool[k]._wrap || vidPool[k]).remove();
      delete vidPool[k];
    });

    curVideoClipId = (topVideoClip() || {}).id || null;

    if (!list.length) {
      stageEmpty.hidden = false;
      stageEmpty.textContent = '재생헤드 위치에 영상 클립이 없습니다';
    } else if (missing) {
      var a = missing.asset;
      var nl = String.fromCharCode(10);
      stageEmpty.hidden = false;
      stageEmpty.textContent = '원본 파일이 연결되지 않았습니다 (' + missing.clip.name + ')'
        + (a && a.path ? nl + a.path + nl
            + (D.Server && D.Server.online
                ? '서버가 이 경로를 못 읽습니다. 파일이 옮겨졌는지 확인하세요.'
                : '대시보드.cmd 로 열면 이 경로를 서버가 읽어 옵니다. '
                  + '또는 파일을 선택 패널에 끌어다 놓으세요.')
           : '');
    } else {
      stageEmpty.hidden = true;
    }
  }

  function syncAudio() {
    /* 영상과 같은 이유로 트랙+소스 기준이다. 클립마다 Audio를 새로 만들면
       컷 자리에서 소리가 한 번 끊겼다가 다시 읽힌다. */
    var want = {};
    if (D.$('#chkPreviewAudio').checked) {
      activeClips('audio').concat(activeClips('sfx')).forEach(function (c) {
        want[poolKey(c)] = c;
      });
    }
    Object.keys(audioPool).forEach(function (k) {
      if (!want[k]) { audioPool[k].pause(); }
    });
    Object.keys(want).forEach(function (k) {
      var c = want[k];
      var a = assetOf(c);
      var url = a ? assetUrl(a) : null;
      if (!url) return;
      var el = audioPool[k];
      if (!el) { el = new Audio(); audioPool[k] = el; }
      if (el.dataset.url !== url) { el.dataset.url = url; el.src = url; }
      el.volume = D.clamp(c.volume, 0, 1);
      el.loop = !!c.loop;
      var w = srcTime(c);
      if (Math.abs(el.currentTime - w) > 0.3) { try { el.currentTime = w; } catch (e) { } }
      if (playing && el.paused) el.play().catch(function () { });
      if (!playing && !el.paused) el.pause();
    });
  }

  /* ---------- 캔버스 ----------

     완성본의 크기만 여기 남는다. 배경 · 영상 띠 · 상단 캡션은 전부 클립이 되어
     타임라인에 있으므로 따로 흉내 낼 것이 없다. */
  function setLayout(lay) {
    D.state.layout = lay || null;
  }

  /* 자막을 완성본과 같은 그림으로 그린다.

     ASS(렌더)의 숫자는 전부 1080x1920 캔버스 기준이다. 미리보기 무대는 그보다
     훨씬 작으므로 외곽선 두께도 그림자 거리도 같은 비율로 줄여야 한다. 예전에는
     이 값들을 px 그대로 썼다 - 무대가 276px일 때 외곽선 3px은 완성본으로 치면
     21px이라, 글자가 외곽선에 파묻혀 보였다.

     외곽선은 한 번 더 손봐야 한다. ASS는 글자 바깥으로만 두르는데 CSS
     text-stroke는 획 한가운데를 기준으로 안팎에 반씩 걸친다. 그래서 두 배로 준다. */
  /* ---------- 발끈 자막의 그라데이션 창 ----------

     ASS 에는 그라데이션이 없어서 build_ass.py 는 같은 글자를 가로 띠로 잘라
     (\clip) 색만 바꿔 쌓는다. 띠가 깔리는 창은 캔버스 좌표로 못 박혀 있고
     (EMPH_Y0 / EMPH_Y1), 그 창 밖은 스타일의 PrimaryColour - 맨 위 노랑 -
     이 그대로 남는다.

     완성본(고구마_ko.mp4 37.2초 "아아아아아아악!") 프레임을 재 보면
         글자 잉크   y 1392 ~ 1482
         띠 창       y 1376 ~ 1476
     즉 창은 잉크 위로 16px 에서 시작해 잉크 위 84px 에서 끝나고, 글자 아래
     끝 여남은 픽셀은 노랑으로 되돌아온다. 실제로 그렇게 나오므로 미리보기도
     그대로 흉내낸다 - 안 그러면 "완성본과 같아 보이게"가 깨진다.

     16 · 84 는 ASS 글자 크기 130 기준의 캔버스 픽셀이다. 브라우저 글자 크기는
     여기에 폰트 배율(D.Fonts.ratio)이 이미 곱해져 있으므로 도로 나눠야
     캔버스 자로 잰 길이가 된다. */
  var EMPH_ABOVE_INK = 16 / 130;
  var EMPH_BELOW_INK = 84 / 130;

  /* 줄 상자 안에서 기준선과 글자 잉크 위끝이 어디인지 (글자 크기 배수).
     actualBoundingBox 는 이 폰트에서 못 미더워서 실제로 한 번 그려 재고
     글꼴 · 글자마다 기억해 둔다. */
  var inkCache = Object.create(null);
  function inkGeom(font, weight, text) {
    var key = font + '|' + weight + '|' + text;
    if (inkCache[key]) return inkCache[key];
    var REF = 130, BASE = 200, W = 1400, H = 420;
    var cv = inkGeom.cv || (inkGeom.cv = document.createElement('canvas'));
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.font = weight + ' ' + REF + 'px ' + font;
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#fff';
    g.fillText((text || '가').split('\n')[0] || '가', 10, BASE);
    var d = g.getImageData(0, 0, W, H).data;
    var top = null;
    for (var y = 0; y < H && top === null; y++) {
      for (var x = 0; x < W; x++) {
        if (d[(y * W + x) * 4 + 3] > 40) { top = y; break; }
      }
    }
    var m = g.measureText('가');
    var lh = REF * 1.25;                                   /* .sub-text 의 line-height */
    var asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
    var r = {
      baseline: (asc && desc) ? ((lh - (asc + desc)) / 2 + asc) / REF : 1.21,
      inkAsc: top === null ? 0.76 : (BASE - top) / REF
    };
    inkCache[key] = r;
    return r;
  }

  function renderSubs() {
    subLayer.innerHTML = '';
    var h = stage.clientHeight || 1;
    var lay = D.state.layout || {};
    var ch = (lay.canvas && lay.canvas[1]) || 1920;
    var k = h / ch;                     /* 캔버스 단위 -> 무대 픽셀 */

    activeClips('caption').forEach(function (c) {
      var st = c.style || D.TL.captionStyle;
      var isEmph = !!st.emphasis;
      var line = D.el('div', { class: 'sub-line' });
      line.style.top = st.posY + '%';
      /* 가로는 줄 전체를 밀어서 옮긴다. left를 만지면 right:0과 싸워서 줄
         너비가 같이 변하고, 그러면 줄바꿈 위치까지 달라진다. */
      line.style.transform = 'translate('
        + ((st.posX === undefined ? 50 : st.posX) - 50) + '%, -50%)';
      line.style.alignItems = st.align === 'left' ? 'flex-start' : (st.align === 'right' ? 'flex-end' : 'center');

      /* 화자는 어느 디자인을 쓸지 고르는 표식이지 화면에 나오는 글자가 아니다.
         담유이 자막에는 이름표가 없다 - 렌더에도 없다. 이름을 같이 보여야 하는
         편집(따옴표 자막 등)에서만 켠다. */
      if (c.speaker && st.showSpeaker) {
        line.appendChild(D.el('span', { class: 'sub-speaker', text: c.speaker }));
      }

      var tx = D.el('div', { class: 'sub-text', text: c.text || '' });
      tx.style.fontFamily = st.font;
      /* 렌더는 폰트 높이를, 브라우저는 em 크기를 글자 크기로 삼는다.
         폰트마다 다른 그 차이를 곱해 줘야 완성본과 같은 크기가 된다. */
      tx.style.fontSize = (st.size / 100 * h * D.Fonts.ratio(st.font)) + 'px';
      tx.style.color = st.color;
      tx.style.fontWeight = st.bold ? '800' : '500';
      tx.style.fontStyle = st.italic ? 'italic' : 'normal';
      tx.style.textAlign = st.align;

      var ow = isEmph ? (st.emphOutlineWidth === undefined ? 7 : st.emphOutlineWidth)
                      : (st.outlineWidth === undefined ? 3 : st.outlineWidth);
      var so = isEmph ? (st.emphShadowOff === undefined ? 6 : st.emphShadowOff)
                      : (st.shadowOff === undefined ? 7 : st.shadowOff);
      var stroke = isEmph ? (st.emphOutline || '#1c2c38') : st.outline;
      var sc = isEmph ? (st.emphShadow || '#dafd73') : st.shadow;
      var shadowCss = (sc && so > 0)
        ? 'drop-shadow(' + (so * k) + 'px ' + (so * k) + 'px 0 ' + sc + ')' : '';

      if (!isEmph) {
        /* 보통 자막: 글자색이 불투명하니 paint-order 로 채움이 외곽선 안쪽
           절반을 덮어 준다. 한 겹으로 충분하다. */
        if (ow > 0 && stroke) {
          tx.style.webkitTextStrokeWidth = (ow * 2 * k) + 'px';
          tx.style.webkitTextStrokeColor = stroke;
          tx.style.paintOrder = 'stroke fill';
        }
        if (shadowCss) tx.style.filter = shadowCss;
      } else {
        /* 발끈 자막은 두 겹으로 그린다.

           한 겹으로 그리면 글자가 어둡고 얇게 뭉갠다. background-clip:text 로
           넣은 그라데이션은 배경이라 글자보다 먼저(아래에) 깔리는데,
           -webkit-text-stroke 는 획 한가운데를 기준으로 안팎에 반씩 걸친다.
           color 가 transparent 라 덮어 줄 채움이 없으니 외곽선 안쪽 절반이
           그라데이션 위에 그대로 얹힌다 - 15px 글씨에 2.2px 외곽선이면 획의
           대부분을 먹는다. paint-order 도 배경까지는 못 옮긴다.

           그래서 ASS 가 하는 것과 같은 순서로 쌓는다.
             뒤   외곽선 + 그림자 (build_ass.py 의 layer 0)
             앞   그라데이션 채움 (\clip 으로 깐 띠들) */
        tx.classList.add('is-emph');
        var txt = c.text || '';
        var back = D.el('span', { class: 'emph-l emph-back', text: txt });
        var fill = D.el('span', { class: 'emph-l emph-fill', text: txt });

        back.style.color = stroke;
        if (ow > 0 && stroke) {
          back.style.webkitTextStrokeWidth = (ow * 2 * k) + 'px';
          back.style.webkitTextStrokeColor = stroke;
          back.style.paintOrder = 'stroke fill';
        }
        if (shadowCss) back.style.filter = shadowCss;

        /* 창을 글자 잉크 위끝에 맞춘다. 줄마다 같은 색이 걸려야 하므로
           한 줄 높이만큼만 깔고 반복시킨다 (스타일 분석의 gradientScope). */
        var fs = parseFloat(tx.style.fontSize);
        var lh = fs * 1.25;
        var geo = inkGeom(st.font, tx.style.fontWeight, txt);
        var canvasFs = fs / (D.Fonts.ratio(st.font) || 1);   /* ASS 자로 잰 글자 크기 */
        var inkTop = geo.baseline * fs - geo.inkAsc * fs;    /* 줄 상자 위끝 기준 px */
        var p0 = (inkTop - EMPH_ABOVE_INK * canvasFs) / lh * 100;
        var p1 = (inkTop + EMPH_BELOW_INK * canvasFs) / lh * 100;
        var top = st.emphTop || '#fbd65a', bot = st.emphBottom || '#fb5d4b';
        fill.style.background = 'linear-gradient(180deg,'
          + top + ' 0,' + top + ' ' + p0.toFixed(1) + '%,'
          + bot + ' ' + p1.toFixed(1) + '%,'
          + top + ' ' + p1.toFixed(1) + '%,' + top + ' 100%)';
        fill.style.backgroundSize = '100% ' + lh + 'px';
        fill.style.backgroundRepeat = 'repeat-y';
        fill.style.webkitBackgroundClip = 'text';
        fill.style.backgroundClip = 'text';
        fill.style.color = 'transparent';

        tx.textContent = '';
        tx.appendChild(back);
        tx.appendChild(fill);
      }

      if (st.bg && st.bg !== 'transparent') {
        tx.style.background = st.bg;
        tx.style.padding = '2px 8px';
        tx.style.borderRadius = '4px';
      }
      line.appendChild(tx);
      line.dataset.clipId = c.id;
      subLayer.appendChild(line);
    });
  }

  /* ---------- 미리보기에서 직접 옮기고 늘리기 ----------

     숫자만으로 자리를 맞추는 건 고문이다. 고른 클립에 상자를 씌워서 끌면
     옮겨지고 모서리를 끌면 크기가 바뀌게 한다. 영상은 화면 자리(frame)를,
     자막은 위치(posX · posY)를 움직인다.

     Alt를 누른 채 영상을 끌면 자리가 아니라 크롭이 움직인다 - 자리는 그대로
     두고 소스에서 보이는 부분만 밀어 넣는 것이다. */

  var HANDLES = [
    ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0],
    ['w', 0, 0.5], ['e', 1, 0.5],
    ['sw', 0, 1], ['s', 0.5, 1], ['se', 1, 1]
  ];

  function selectedClip() {
    var sel = D.TL.selected();
    return sel.length === 1 ? sel[0] : null;
  }

  function drawHandles() {
    if (!hitLayer) return;
    hitLayer.innerHTML = '';
    var c = selectedClip();
    if (!c) return;
    var cs = canvasSize(), cw = cs[0], ch = cs[1];

    if (c.kind === 'video') {
      var live = vidPool[poolKey(c)];
      if (!live || live._clipId !== c.id) return;
      var f = c.frame || { x: 0, y: 0, w: cw, h: ch };
      var box = D.el('div', { class: 'hit-box' });
      box.style.left = (f.x / cw * 100) + '%';
      box.style.top = (f.y / ch * 100) + '%';
      box.style.width = (f.w / cw * 100) + '%';
      box.style.height = (f.h / ch * 100) + '%';
      HANDLES.forEach(function (h) {
        var g = D.el('div', { class: 'hit-h hit-' + h[0] });
        g.style.left = (h[1] * 100) + '%';
        g.style.top = (h[2] * 100) + '%';
        g.dataset.dir = h[0];
        box.appendChild(g);
      });
      box.appendChild(D.el('div', {
        class: 'hit-tip',
        text: Math.round(f.w) + 'x' + Math.round(f.h) + '  @' + Math.round(f.x) + ',' + Math.round(f.y)
          + (c.crop ? '  크롭' : '')
      }));
      hitLayer.appendChild(box);
      bindDrag(box, c, 'video');
      return;
    }

    if (c.kind === 'caption') {
      var line = subLayer.querySelector('[data-clip-id="' + c.id + '"]');
      if (!line) return;
      var lb = line.getBoundingClientRect(), sb = stage.getBoundingClientRect();
      var box2 = D.el('div', { class: 'hit-box hit-cap' });
      box2.style.left = ((lb.left - sb.left) / sb.width * 100) + '%';
      box2.style.top = ((lb.top - sb.top) / sb.height * 100) + '%';
      box2.style.width = (lb.width / sb.width * 100) + '%';
      box2.style.height = (lb.height / sb.height * 100) + '%';
      var st = c.style || D.TL.captionStyle;
      box2.appendChild(D.el('div', {
        class: 'hit-tip',
        text: '가로 ' + Math.round(st.posX === undefined ? 50 : st.posX) + '%  세로 '
          + Math.round(st.posY) + '%  크기 ' + (Math.round(st.size * 10) / 10) + '%'
      }));
      hitLayer.appendChild(box2);
      bindDrag(box2, c, 'caption');
    }
  }

  function bindDrag(box, c, kind) {
    box.addEventListener('pointerdown', function (ev) {
      var dir = ev.target && ev.target.dataset ? ev.target.dataset.dir : null;
      ev.preventDefault();
      ev.stopPropagation();
      var sb = stage.getBoundingClientRect();
      var cs = canvasSize(), cw = cs[0], ch = cs[1];
      var x0 = ev.clientX, y0 = ev.clientY;
      var alt = ev.altKey;
      var f0 = c.frame ? { x: c.frame.x, y: c.frame.y, w: c.frame.w, h: c.frame.h }
                       : { x: 0, y: 0, w: cw, h: ch };
      var cr0 = c.crop ? { x: c.crop.x, y: c.crop.y, w: c.crop.w, h: c.crop.h }
                       : { x: 0, y: 0, w: 1, h: 1 };
      var st = c.style || D.TL.captionStyle;
      var p0 = { x: st.posX === undefined ? 50 : st.posX, y: st.posY };

      function move(e2) {
        var dx = (e2.clientX - x0) / sb.width;      /* 무대 비율 */
        var dy = (e2.clientY - y0) / sb.height;

        if (kind === 'caption') {
          st.posX = D.round(D.clamp(p0.x + dx * 100, -20, 120), 2);
          st.posY = D.round(D.clamp(p0.y + dy * 100, 0, 100), 2);
          renderSubs();
          drawHandles();
          return;
        }

        if (alt) {
          /* 크롭 밀기 - 소스에서 보이는 창을 움직인다 */
          var nx = cr0.x - dx * cr0.w, ny = cr0.y - dy * cr0.h;
          c.crop = {
            x: D.round(D.clamp(nx, 0, 1 - cr0.w), 4),
            y: D.round(D.clamp(ny, 0, 1 - cr0.h), 4),
            w: cr0.w, h: cr0.h
          };
          syncVideos();
          drawHandles();
          return;
        }

        var f = { x: f0.x, y: f0.y, w: f0.w, h: f0.h };
        var mx = dx * cw, my = dy * ch;             /* 캔버스 픽셀 */
        if (!dir) { f.x = f0.x + mx; f.y = f0.y + my; }
        else {
          if (dir.indexOf('w') !== -1) { f.x = f0.x + mx; f.w = f0.w - mx; }
          if (dir.indexOf('e') !== -1) { f.w = f0.w + mx; }
          if (dir.indexOf('n') !== -1) { f.y = f0.y + my; f.h = f0.h - my; }
          if (dir.indexOf('s') !== -1) { f.h = f0.h + my; }
          if (e2.shiftKey && f0.w > 0) {            /* 비율 유지 */
            var r = f0.h / f0.w;
            f.h = Math.max(8, f.w * r);
            if (dir.indexOf('n') !== -1) f.y = f0.y + f0.h - f.h;
          }
        }
        f.w = Math.max(8, Math.round(f.w));
        f.h = Math.max(8, Math.round(f.h));
        f.x = Math.round(f.x);
        f.y = Math.round(f.y);
        c.frame = f;
        syncVideos();
        drawHandles();
      }

      function up() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        D.TL.changed();
        D.Inspector.render();
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  /* 무대를 눌러 클립을 고른다. 위에 있는 영상부터 본다. */
  function bindStagePick() {
    stage.addEventListener('pointerdown', function (ev) {
      if (ev.target.closest && ev.target.closest('.hit-box')) return;
      var sb = stage.getBoundingClientRect();
      var line = Array.prototype.filter.call(subLayer.children, function (n) {
        var b = n.getBoundingClientRect();
        return ev.clientX >= b.left && ev.clientX <= b.right
          && ev.clientY >= b.top && ev.clientY <= b.bottom;
      })[0];
      if (line && line.dataset.clipId) { D.TL.select([line.dataset.clipId]); return; }
      var boxes = Array.prototype.slice.call(vidLayer.children).sort(function (a, b) {
        return (+b.style.zIndex || 0) - (+a.style.zIndex || 0);
      });
      for (var i = 0; i < boxes.length; i++) {
        var b2 = boxes[i].getBoundingClientRect();
        if (ev.clientX >= b2.left && ev.clientX <= b2.right
          && ev.clientY >= b2.top && ev.clientY <= b2.bottom) {
          D.TL.select([boxes[i].dataset.clipId]);
          return;
        }
      }
      void sb;
      D.TL.select([]);
    });
  }

  /* 미리보기 상자의 비율은 **프로젝트의 캔버스**를 따라간다.

     예전에는 콤보박스로만 정했고 기본값이 9:16이었다. 롱폼(1920x1080)
     프로젝트를 열면 세로 상자 안에 가로 영상이 들어가 완성본과 딴판으로
     보였고, 열 때마다 손으로 16:9를 골라야 했다. 캔버스를 아는 마당에
     물어볼 일이 아니다. 콤보박스는 그 값을 비추고, 손으로 바꾸면 그때는
     고른 대로 둔다. */
  function syncRatio() {
    var cs = canvasSize();
    var want = cs[0] + '/' + cs[1];
    if (stage.dataset.ratio === want) return;
    stage.dataset.ratio = want;
    stage.style.aspectRatio = want;
    var sel = D.$('#previewRatio');
    if (!sel) return;
    var g = Math.abs(cs[0] / cs[1] - 9 / 16) < 0.01 ? '9/16'
      : Math.abs(cs[0] / cs[1] - 16 / 9) < 0.01 ? '16/9'
        : Math.abs(cs[0] / cs[1] - 1) < 0.01 ? '1/1' : '';
    if (g) sel.value = g;
  }

  function refreshPreview() {
    syncRatio();
    syncVideos();
    syncAudio();
    renderSubs();
    drawHandles();
  }

  function tick(ts) {
    if (!playing) return;
    var dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;
    var next = E.playhead + dt;
    var end = D.TL.contentEnd();
    if (next >= end) { D.TL.setPlayhead(end); pause(); return; }
    /* quiet(이벤트 없이)로 옮기지만 스크롤은 따라가게 둔다 - 재생선이
       화면 밖으로 나가면 타임라인이 저절로 밀린다 */
    D.TL.setPlayhead(next, true);
    D.$$('[data-tc-now]').forEach(function (n) { n.textContent = D.fmtTime(E.playhead); });
    refreshPreview();
    rafId = requestAnimationFrame(tick);
  }

  function play() {
    if (playing) return;
    if (!E.clips.length) { D.warn('재생할 클립이 없습니다.', 'preview'); return; }
    if (E.playhead >= D.TL.contentEnd()) D.TL.setPlayhead(0);
    playing = true; lastTs = 0;
    setPlayIcon(true);
    refreshPreview();
    rafId = requestAnimationFrame(tick);
  }

  function pause() {
    if (!playing) return;
    playing = false;
    cancelAnimationFrame(rafId);
    setPlayIcon(false);
    refreshPreview();
  }

  function setPlayIcon(on) {
    D.$$('[data-play]').forEach(function (b) {
      var u = b.querySelector('use');
      if (u) u.setAttribute('href', on ? '#i-pause' : '#i-play');
    });
  }

  /* =================== 렌더 작업 =================== */
  function buildRenderJob() {
    var byId = {};
    E.assets.forEach(function (a) { byId[a.id] = a; });
    return {
      task: 'timeline.render',
      createdAt: new Date().toISOString(),
      /* 어느 프로젝트의 렌더인지. 편집마다 프로젝트가 따로라서, 이게 없으면
         파이프라인이 어느 폴더에 되돌려 넣어야 할지 알 수 없다. */
      project: {
        id: D.state.project.id, name: D.state.project.name,
        style: D.state.project.style || D.state.ai.styleName || ''
      },
      layout: D.state.layout,
      editNotes: D.state.editNotes || [],
      note: '편집 결과는 렌더링 시에만 실제로 적용된다. 편집 중에는 아무것도 굽지 않는다.',
      aiPolicy: D.state.ai.policy,
      subtitleLanguages: D.state.ai.langs,
      extraPrompt: D.state.ai.prompt || '',
      duration: D.round(D.TL.contentEnd(), 3),
      tracks: D.TL.tracks().map(function (t) {
        /* role은 파이프라인이 어느 트랙이 무엇인지 알아보는 표식이다.
           배경 프리셋도 영상 클립이고 상단 캡션도 자막 클립이라, 종류만
           봐서는 컷과 자막을 가릴 수 없다. */
        return { id: t.id, kind: t.kind, name: t.name, role: t.role || '', muted: t.muted, locked: t.locked };
      }),
      clips: E.clips.slice().sort(function (a, b) { return a.start - b.start; }).map(function (c) {
        var a = byId[c.assetId];
        var o = {
          id: c.id, track: c.trackId, kind: c.kind, name: c.name,
          start: D.round(c.start, 3), end: D.round(c.start + c.dur, 3), duration: D.round(c.dur, 3),
          sourceIn: D.round(c.offset, 3),
          source: a ? a.path : null,
          groupId: c.groupId || null
        };
        if (c.kind === 'caption') { o.speaker = c.speaker; o.text = c.text; o.style = c.style; }
        if (c.kind === 'audio' || c.kind === 'sfx') o.volume = c.volume;
        if (c.kind === 'video') {
          o.opacity = c.opacity;
          o.volume = c.volume;
          o.frame = c.frame || null;    /* 완성본의 어디에 이 영상이 놓이는지 */
          o.crop = c.crop || null;      /* 소스의 어느 부분을 쓰는지 (0~1 비율) */
          o.loop = !!c.loop;
        }
        return o;
      })
    };
  }

  /* ---------- 자막이 무슨 말로 적혀 있나 ----------

     렌더에 클로드를 부를지 말지가 여기서 갈린다. 고른 언어로 이미 적혀 있는
     자막은 번역할 것이 없으니 그냥 구우면 된다.

     글자가 어느 글자판에 속하는지로 가른다. 사전도 모델도 없이 판별되는
     것만 본다 - 한글 · 가나 · 한자 · 로마자. 일본어와 중국어는 한자를
     공유해서 가나가 없는 짧은 일본어 자막은 중국어로 볼 수 있다. 지금
     쓰는 두 언어(한국어 · 영어)는 겹치지 않는다. */
  var SCRIPTS = {
    ko: /[가-힣ᄀ-ᇿ]/g,      /* 한글 */
    ja: /[぀-ヿ]/g,                   /* 히라가나 · 가타카나 */
    zh: /[一-鿿]/g,                   /* 한자 */
    en: /[A-Za-z]/g                           /* 로마자 */
  };
  var LANG_SHARE = 0.8;      /* 이만큼은 한 언어여야 "이 자막은 X다"라고 본다 */

  function langOf(text) {
    var t = String(text || '');
    var best = '', n = 0;
    Object.keys(SCRIPTS).forEach(function (k) {
      var m = t.match(SCRIPTS[k]);
      if (m && m.length > n) { n = m.length; best = k; }
    });
    return best;             /* 숫자 · 기호뿐이면 '' - 어느 언어도 아니다 */
  }

  function langReport() {
    /* 상단 캡션도 화면에 글자로 나오는 것이니 함께 센다. 예전에는 이걸 빼
       두었는데, 그러면 영어판에 한국어 제목이 그대로 남는다 (제목은
       파이프라인 상수였다 - 지금은 자막 CSV로 나간다). */
    var caps = E.clips.filter(function (c) { return c.kind === 'caption'; });
    var counts = {}, of = {}, typed = 0;
    caps.forEach(function (c) {
      var lg = langOf(c.text);
      of[c.id] = lg;
      if (lg) { counts[lg] = (counts[lg] || 0) + 1; typed += 1; }
    });
    var main = '', top = 0;
    Object.keys(counts).forEach(function (k) {
      if (counts[k] > top) { top = counts[k]; main = k; }
    });
    return {
      caps: caps, of: of, counts: counts, typed: typed,
      main: main, share: typed ? top / typed : 0
    };
  }

  /* ---------- 이미 옮겨 둔 번역 ----------

     번역은 프로젝트가 아니라 파이프라인 폴더에 CSV 로 남는다. 이미 있으면
     클로드를 다시 부를 이유가 없다 - 다만 그 뒤에 컷이 바뀌었으면 자막
     시각이 통째로 밀리므로 그대로 쓰면 안 된다.

     그래서 CSV 의 시각을 지금 자막과 견준다. 컷이 바뀌면 자막 시각도 따라
     바뀌므로, 시각이 그대로면 그 번역은 이 편집에 맞는 것이다. */
  var TRANS = { dir: null, langs: {} };
  var transBusy = false;

  function refreshTranslations() {
    var dir = D.state.render.dir;
    if (!D.Server.online || !dir) {
      TRANS = { dir: dir, langs: {} };
      return Promise.resolve(false);
    }
    if (transBusy) return Promise.resolve(false);
    transBusy = true;
    return fetch('/api/translations?dir=' + encodeURIComponent(dir))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        TRANS = { dir: dir, langs: (d.ok && d.langs) || {} };
        return true;
      })
      .catch(function () { TRANS = { dir: dir, langs: {} }; return true; })
      .then(function (v) { transBusy = false; return v; });
  }

  function translationFits(lang, caps) {
    var t = TRANS.langs[lang];
    if (!t || !t.rows || t.rows.length !== caps.length || !caps.length) return false;
    var mine = caps.slice().sort(function (a, b) { return a.start - b.start; });
    return mine.every(function (c, i) {
      var r = t.rows[i];
      /* 무엇을 옮긴 것인지 적혀 있지 않으면 맞는지 알 수 없다. 시각만
         견주면 글자만 고친 자막을 못 잡아내고 낡은 번역이 그대로 구워진다. */
      if (!r.src || r.src !== String(c.text || '').trim()) return false;
      /* CSV 는 0.01초까지만 적는다. 그 언저리는 같은 자리로 본다. */
      return Math.abs(r.start - c.start) < 0.02
        && Math.abs(r.end - (c.start + c.dur)) < 0.02;
    });
  }

  /* 고른 언어를 "바로 구울 것"과 "클로드가 손볼 것"으로 가른다. */
  function renderPlan() {
    var rep = langReport();
    var langs = (D.state.ai.langs || []).filter(function (x) { return x; });
    if (!langs.length) langs = [D.state.render.base || rep.main || 'ko'];
    var direct = [], viaAI = [];
    var trusted = rep.share >= LANG_SHARE;
    langs.forEach(function (lg) {
      /* 자막이 여러 말로 섞여 있으면 어느 쪽이 원본인지 정할 수가 없다.
         그럴 땐 판단하지 말고 통째로 넘긴다. */
      var fix = trusted
        ? rep.caps.filter(function (c) { return rep.of[c.id] && rep.of[c.id] !== lg; })
        : rep.caps.slice();
      if (!fix.length) direct.push({ lang: lg, fix: [] });
      else if (translationFits(lg, rep.caps)) direct.push({ lang: lg, fix: [], reused: true });
      else viaAI.push({ lang: lg, fix: fix });
    });
    return { report: rep, langs: langs, direct: direct, viaAI: viaAI, trusted: trusted };
  }

  /* 클로드에게 무엇을 부탁하는지. 컷과 그림은 서버가 이미 굽고 있으므로,
     넘길 것이 자막 번역뿐이면 그것만 부탁한다 - 통째로 넘기면 모델이
     멀쩡한 컷을 다시 잡는다. */
  function renderPrompt(job, langs, fix) {
    langs = langs || job.subtitleLanguages || [];
    if (fix && fix.length) {
      return [
        '# 자막 번역 요청 (' + langs.join(', ') + ')',
        '',
        '컷과 영상은 대시보드가 이미 굽고 있다. 타임라인은 건드리지 마라.',
        '아래 자막만 ' + langs.join(', ') + '로 옮기면 된다.',
        '',
        '- 옮길 자막: ' + fix.length + '장 (첨부 JSON의 captionsToTranslate)',
        '- 시각(start · end)과 화자는 그대로 둔다. 글자만 바꾼다',
        '- 자막 규칙: 마침표 금지, 폭은 글자 수가 아니라 픽셀로 잰다',
        '- 화자 "제목"은 화면 위에 늘 떠 있는 상단 캡션이다. 이것도 옮긴다',
        '- 뜻이 아니라 느낌을 옮긴다. 한 나라에서만 통하는 말은 같은 감정을',
        '  부르는 그 나라 말로 바꾼다 - 직역하면 뜻은 맞고 웃음이 사라진다',
        '  (스타일 JSON의 localization 참고)',
        '',
        job.extraPrompt ? '## 추가 지시\n' + job.extraPrompt + '\n' : '',
        '## 다음',
        '옮긴 자막을 <프로젝트>_' + (langs[0] || 'xx') + '_subtitles.csv 로 저장하고',
        'apply_captions_' + (langs[0] || 'xx') + '.py 를 돌리면 끝난다.',
        '',
        'CSV 칸은 start, end, speaker, text, src 다. src 에는 옮기기 전의',
        '원문을 그대로 적는다 - 다음 번에 대시보드가 이 번역을 다시 쓸 수',
        '있는지 이걸로 가린다. 빠지면 자막이 그대로여도 매번 다시 옮기게 된다.'
      ].join('\n');
    }
    return [
      '# 타임라인 렌더 요청',
      '',
      '대시보드에서 확정한 타임라인을 실제로 렌더링해줘. 편집 중에는 아무것도 굽지 않았고, 이 요청이 첫 실제 적용이다.',
      '',
      '- 전체 길이: ' + D.fmtTime(job.duration),
      '- 트랙 ' + job.tracks.length + '개 / 클립 ' + job.clips.length + '개',
      '- 자막 언어: ' + (langs.length ? langs.join(', ') + ' (언어 수만큼 결과 영상 생성, 영상 · 오디오 동일)' : '원본 1종'),
      '- AI 호출 정책: ' + job.aiPolicy + ' (결정적으로 처리 가능한 구간은 스크립트로, 모델은 필요한 지점에서만)',
      '',
      job.extraPrompt ? '## 추가 지시\n' + job.extraPrompt + '\n' : '',
      '## 작업 정의',
      '첨부한 timeline_render.json의 clips를 그대로 사용한다. start / end / sourceIn은 초 단위이며,',
      'groupId가 같은 영상 · 오디오 클립은 동일 타임스탬프로 묶여 있다.'
    ].join('\n');
  }

  /* 클로드에게 넘기는 길. 서버가 있으면 jobs/ 폴더에 파일로 떨어지고,
     없으면 클립보드로 간다. 이제 이 길로는 손볼 것이 있는 자막만 간다. */
  function handoff(job, langs, fix) {
    var payload = {
      task: "timeline.render",
      duration: job.duration,
      subtitleLanguages: langs,
      clips: job.clips,
      tracks: D.TL.tracks(),
      assets: E.assets.map(function (x) {
        return { id: x.id, kind: x.kind, name: x.name, path: x.path, duration: x.duration };
      }),
      extraPrompt: D.state.ai.prompt || ""
    };
    if (fix) payload.captionsToTranslate = fix;
    D.Server.submit((D.state.project.name || '타임라인') + ' 렌더',
      renderPrompt(job, langs, fix), payload);
  }

  /* ---------- 서버가 직접 굽기 ---------- */
  var RND = { id: null, timer: null, rec: null };

  /* 굽는 동안 타임라인 버튼에도 표가 나야 한다. 인스펙터를 안 보고 있으면
     아무 일도 안 일어나는 것처럼 보인다. */
  function markBusy(on, pct) {
    var b = D.$('#btnRender');
    if (!b) return;
    b.classList.toggle('is-busy', !!on);
    b.disabled = !!on;
    b.title = on ? '굽는 중 · ' + (pct || 0) + '%' : '렌더링';
  }

  function renderTick() {
    if (!RND.id) return;
    D.Server.renderStatus(RND.id).then(function (r) {
      RND.rec = r.render;
      markBusy(RND.rec.state === 'running', RND.rec.percent);
      D.emit('render:tick', RND.rec);
      if (RND.rec.state === 'running') return;
      clearInterval(RND.timer);
      RND.timer = null;
      if (RND.rec.state === 'error') {
        D.error('렌더 실패: ' + RND.rec.error, 'render');
        D.toast('렌더 실패 - ' + RND.rec.error);
      } else {
        var secs = Math.round((RND.rec.endedAt - RND.rec.startedAt));
        D.info('렌더 완료 (' + secs + '초)', 'render');
        D.toast('렌더 완료 - ' + secs + '초');
      }
      refreshTranslations().then(function () { D.emit('render:tick', RND.rec); });
    }).catch(function (e) {
      clearInterval(RND.timer);
      RND.timer = null;
      markBusy(false);
      D.error('렌더 진행을 읽지 못했습니다: ' + e.message, 'render');
    });
  }

  function startServerRender(langs) {
    var cfg = D.state.render;
    return D.Server.startRender({
      project: D.state.project.id,
      dir: cfg.dir,
      out: cfg.out || '',
      langs: langs,
      base: cfg.base || 'ko'
    }).then(function (r) {
      RND.id = r.id;
      RND.rec = {
        id: r.id, state: 'running', step: 0, steps: r.steps, log: [], error: null,
        percent: 0, elapsed: 0, stepElapsed: 0, eta: null, estimated: false, skipped: []
      };
      D.info('렌더 시작: ' + langs.join(', ') + ' (' + r.steps.length + '단계)', 'render');
      markBusy(true);
      D.emit('render:tick', RND.rec);
      if (RND.timer) clearInterval(RND.timer);
      RND.timer = setInterval(renderTick, 1000);
    }).catch(function (e) {
      D.error('렌더를 시작하지 못했습니다: ' + e.message, 'render');
      markBusy(false);
      D.emit('render:tick', null);
      throw e;
    });
  }

  function doRender() {
    if (!E.clips.length) { D.error('렌더할 클립이 없습니다.', 'render'); return; }
    if (RND.timer) { D.warn('이미 굽고 있습니다.', 'render'); return; }
    var job = buildRenderJob();
    var problems = 0;
    E.clips.forEach(function (c) {
      if (c.kind !== 'caption' && !c.assetId) { D.warn('소스가 없는 클립: ' + c.name, 'render'); problems += 1; }
      if (c.kind === 'caption' && !String(c.text || '').trim()) { D.warn('빈 자막 클립: ' + D.fmtTime(c.start), 'render'); problems += 1; }
    });
    if (problems) D.warn('확인이 필요한 항목 ' + problems + '건이 있습니다.', 'render');

    var plan = renderPlan();
    if (!plan.trusted) {
      D.warn('자막이 한 언어로 모이지 않습니다(가장 많은 말이 '
        + Math.round(plan.report.share * 100) + '%). 어느 쪽이 원본인지 정할 수 없어 '
        + '자막을 통째로 클로드에게 넘깁니다.', 'render');
    }

    /* 서버가 없으면 굽지 못한다. 예전처럼 통째로 넘긴다. */
    if (!D.Server.online) {
      D.warn('로컬 서버가 없어 직접 굽지 못합니다. 작업으로 넘깁니다.', 'render');
      handoff(job, plan.langs, null);
      return;
    }
    if (!D.state.render.dir) {
      D.error('렌더링 설정에서 파이프라인 폴더를 먼저 정하세요 (인스펙터, 선택 없음).', 'render');
      D.TL.select([]);
      return;
    }

    /* 손볼 것이 있는 언어만 클로드에게 간다. 나머지는 바로 굽는다. */
    plan.viaAI.forEach(function (v) {
      D.info('자막 ' + v.fix.length + '장이 ' + v.lang + '가 아닙니다. 그것만 클로드로 넘깁니다.', 'render');
      handoff(job, [v.lang], v.fix.map(function (c) {
        return { id: c.id, start: D.round(c.start, 3), end: D.round(c.start + c.dur, 3),
                 speaker: c.speaker, text: c.text, lang: plan.report.of[c.id] || '?' };
      }));
    });

    if (!plan.direct.length) {
      D.warn('바로 구울 언어가 없습니다. 번역이 끝나면 다시 누르세요.', 'render');
      return;
    }
    plan.direct.forEach(function (d) {
      if (d.reused) D.info(d.lang + ': 이미 옮겨 둔 자막이 지금 컷과 맞습니다. 그대로 굽습니다.', 'render');
    });
    D.info('클립 ' + job.clips.length + '개 · 길이 ' + D.fmtTime(job.duration)
      + ' · 바로 굽는 언어 ' + plan.direct.map(function (d) { return d.lang; }).join(', '), 'render');
    startServerRender(plan.direct.map(function (d) { return d.lang; }));
  }

  /* =================== 레인 드랍 =================== */
  function bindLaneDrops() {
    var lanes = D.$('#tlLanes');

    lanes.addEventListener('dragover', function (ev) {
      if (Array.prototype.indexOf.call(ev.dataTransfer.types, 'text/x-asset-id') === -1) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
      var lane = ev.target.closest('.tl-lane');
      D.$$('.tl-lane', lanes).forEach(function (l) { l.classList.toggle('is-drop', l === lane); });
    });
    lanes.addEventListener('dragleave', function () {
      D.$$('.tl-lane', lanes).forEach(function (l) { l.classList.remove('is-drop'); });
    });
    lanes.addEventListener('drop', function (ev) {
      var id = ev.dataTransfer.getData('text/x-asset-id');
      D.$$('.tl-lane', lanes).forEach(function (l) { l.classList.remove('is-drop'); });
      if (!id) return;
      ev.preventDefault();
      var lane = ev.target.closest('.tl-lane');
      var a = E.assets.filter(function (x) { return x.id === id; })[0];
      if (!a) return;
      placeAsset(a, lane ? lane.dataset.id : null, D.TL.timeAt(ev.clientX));
    });

    /* OS에서 직접 트랙 위로 드랍 */
    D.dropTarget(lanes, function (nodes, ev) {
      var lane = ev.target.closest ? ev.target.closest('.tl-lane') : null;
      var at = D.TL.timeAt(ev.clientX);
      addNodes(nodes).then(function (added) {
        added.forEach(function (a, i) {
          placeAsset(a, lane ? lane.dataset.id : null, at + i * 0.001);
        });
      });
    }, 'is-drop');
  }

  /* =================== 마운트 =================== */
  D.Editor = {
    mount: function () {
      stage = D.$('#stage');
      vidLayer = D.$('#vidLayer');
      hitLayer = D.$('#hitLayer');
      stageEmpty = D.$('#stageEmpty');
      subLayer = D.$('#subLayer');

      /* 선택 드롭존 */
      var dz = D.$('.dropzone[data-dz="bin"]');
      D.DropZone.init(dz, {
        multiple: true,
        onChange: function (nodes, added) { addNodes(added); dz._nodes = []; D.DropZone.render(dz); }
      });

      D.$('#btnBinClear').addEventListener('click', function () {
        E.assets.forEach(function (a) { if (a._url) URL.revokeObjectURL(a._url); });
        E.assets = [];
        renderBin();
        D.warn('선택 목록을 비웠습니다.', 'asset');
        D.touch();
      });

      /* 트랜스포트 */
      D.$$('[data-play]').forEach(function (b) {
        b.addEventListener('click', function () { playing ? pause() : play(); });
      });
      /* "오디오 미리듣기"는 글자를 빼고 스피커 아이콘 하나로 줄였다.
         체크 표시가 없어졌으니 켜졌는지는 버튼 색으로 알린다. */
      D.$('#chkPreviewAudio').addEventListener('change', function (e) {
        var lbl = D.$('#lblPreviewAudio');
        if (lbl) lbl.classList.toggle('is-on', e.target.checked);
        refreshPreview();
      });
      D.$('#previewRatio').addEventListener('change', function (e) {
        /* 손으로 고른 값이 이기게 둔다. dataset을 같이 적어 syncRatio가
           도로 덮어쓰지 않게 한다 - 프로젝트를 바꾸면 캔버스가 달라지므로
           그때는 다시 따라간다. */
        stage.dataset.ratio = e.target.value;
        stage.style.aspectRatio = e.target.value;
        renderSubs();
      });

      /* 툴바 */
      D.$('#btnCut').addEventListener('click', function () { D.TL.splitAt(E.playhead); });
      D.$('#btnDel').addEventListener('click', function () { D.TL.deleteSelected(); });
      D.$('#btnCap').addEventListener('click', addCaptionAtPlayhead);
      D.$('#btnDup').addEventListener('click', duplicateSelected);
      D.$('#btnRender').addEventListener('click', doRender);
      var menu = D.$('#menuAddTrack');
      D.$('#btnAddTrack').addEventListener('click', function (e) {
        e.stopPropagation();
        menu.hidden = !menu.hidden;
      });
      document.addEventListener('click', function () { menu.hidden = true; });
      D.$$('li', menu).forEach(function (li) {
        li.addEventListener('click', function () { D.TL.addTrack(li.dataset.kind); menu.hidden = true; });
      });

      var sync = D.$('#btnSync');
      sync.addEventListener('click', function () {
        E.sync = !E.sync;
        sync.classList.toggle('is-on', E.sync);
        D.touch();
      });
      var snapBtn = D.$('#btnSnap');
      snapBtn.addEventListener('click', function () {
        E.snap = !E.snap;
        snapBtn.classList.toggle('is-on', E.snap);
        D.touch();
      });

      var zoom = D.$('#zoom');
      zoom.value = E.pxPerSec;
      zoom.addEventListener('input', function () { D.TL.setZoom(parseFloat(zoom.value)); });

      bindLaneDrops();

      /* 이벤트 */
      bindStagePick();
      D.on('selection:changed', drawHandles);
      D.on('playhead', refreshPreview);
      D.on('timeline:changed', function () { refreshPreview(); D.$('#tcTotal').textContent = D.fmtTime(D.TL.contentEnd()); });
      D.on('preview:refresh', refreshPreview);

      /* 서버는 페이지보다 늦게 붙을 수 있다. 그 전에 그린 미리보기는 경로로만
         있는 원본(배경 프리셋 같은 것)을 못 읽어 빈 화면이 된다. 붙는 순간
         다시 그린다 - 이게 없어서 프리셋 배경이 안 나왔다. */
      D.on('server:online', function () {
        renderBin();
        refreshPreview();
        refreshTranslations().then(function () { D.Inspector.render(); });
      });
      /* 폰트 크기는 폰트 파일의 값에 따라 달라진다. 목록이 늦게 오면 그때
         자막을 다시 그려야 완성본과 같은 크기가 된다. */
      D.on('fonts:loaded', function () { renderSubs(); drawHandles(); });
      D.Fonts.load();

      renderBin();
      refreshPreview();
    },
    addNodes: addNodes,
    renderBin: renderBin,
    refreshPreview: refreshPreview,
    setLayout: setLayout,
    drawHandles: drawHandles,
    addCaption: addCaptionAtPlayhead,
    duplicate: duplicateSelected,
    copy: copySelected,
    paste: pasteAtPlayhead,
    play: play,
    pause: pause,
    isPlaying: function () { return playing; },
    toggle: function () { playing ? pause() : play(); },
    importCsvText: importCsvText,
    buildRenderJob: buildRenderJob,
    doRender: doRender,
    renderPlan: renderPlan,
    refreshTranslations: refreshTranslations,
    renderRec: function () { return RND.rec; }
  };

})(window.D);
