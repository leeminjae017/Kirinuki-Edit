/* ==========================================================================
   projects.js - 프로젝트 (편집 한 편 = 프로젝트 하나)

   편집은 저마다 다른 원본, 다른 컷, 다른 자막, 다른 레이아웃을 쓴다. 지금까지
   대시보드는 상태를 한 덩어리로만 들고 있어서, 다음 편집을 시작하면 앞의 것이
   그대로 덮였다. 담아맷돌을 열면 고구마가 사라지는 식이다. 그래서 편집마다
   독립된 프로젝트를 주고, 대시보드의 모든 상태(컷·자막·레이아웃·판단 메모·
   스타일 선택)는 그 프로젝트에 딸린 것으로 본다.

   저장되는 곳
     로컬 서버가 붙어 있으면  ..\projects\<id>\  (project.json + meta.json + thumb.jpg)
     서버가 없으면            브라우저 localStorage

   서버가 처음 붙는 순간, 브라우저에만 있던 프로젝트를 서버로 옮긴다. 옮긴
   뒤에는 브라우저 쪽을 비운다 - 양쪽에 남겨 두면 서버에서 지운 것이 다음에
   되살아난다.
   ========================================================================== */
(function (D) {
  'use strict';

  var LS_INDEX = 'edit-dashboard-projects-v1';
  var LS_PROJ = 'edit-dashboard-project-';

  var P = {
    list: [],          // 목록에 쓰는 요약(meta)들
    where: '',         // 지금 어디에 저장되는지 (화면 아래에 보여 준다)
    dirty: false,
    /* 디스크에서 마지막으로 읽거나 디스크에 마지막으로 쓴 시각. diskNewer 가
       이걸로 견준다. 페이지를 켠 직후에는 비어 있다 - 아직 파일을 안 봤다. */
    diskAt: ''
  };

  function online() { return !!(D.Server && D.Server.online); }
  function E() { return D.state.editor; }
  function cur() { return D.state.project; }

  function newId() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ---------- 저장소 ---------------------------------------------------- */

  function lsIndex() {
    try { return JSON.parse(localStorage.getItem(LS_INDEX) || '[]'); }
    catch (e) { return []; }
  }

  function lsSetIndex(arr) {
    try { localStorage.setItem(LS_INDEX, JSON.stringify(arr)); }
    catch (e) {
      // 썸네일이 자리를 다 먹은 경우다. 그림을 버리고 목록만 지킨다.
      try {
        localStorage.setItem(LS_INDEX, JSON.stringify(arr.map(function (m) {
          var o = {}; Object.keys(m).forEach(function (k) { if (k !== 'thumb') o[k] = m[k]; });
          return o;
        })));
        D.warn('브라우저 저장 공간이 모자라 카드 썸네일을 지웠습니다. '
          + '대시보드.cmd 로 열면 프로젝트가 디스크에 저장됩니다.', 'project');
      } catch (e2) {
        D.error('프로젝트 목록 저장 실패: ' + e2.message, 'project');
      }
    }
  }

  var Store = {
    list: function () {
      if (!online()) {
        P.where = '브라우저 저장소 (서버 없이 열림)';
        return Promise.resolve(lsIndex());
      }
      return fetch('/api/projects').then(function (r) { return r.json(); })
        .then(function (d) {
          P.where = d.dir || '';
          return (d.projects || []).map(function (m) {
            if (m.hasThumb) m.thumb = '/api/project/thumb?id=' + encodeURIComponent(m.id)
              + '&t=' + encodeURIComponent(m.savedAt || '');
            return m;
          });
        });
    },

    read: function (id) {
      if (!online()) {
        try {
          var raw = localStorage.getItem(LS_PROJ + id);
          return Promise.resolve(raw ? JSON.parse(raw) : null);
        } catch (e) { return Promise.resolve(null); }
      }
      return fetch('/api/project?id=' + encodeURIComponent(id))
        .then(function (r) { return r.json(); })
        .then(function (d) { return d.ok ? d.project : null; });
    },

    save: function (id, meta, data, thumb) {
      if (!online()) {
        try { localStorage.setItem(LS_PROJ + id, JSON.stringify(data)); }
        catch (e) { return Promise.reject(new Error('브라우저 저장 공간 부족: ' + e.message)); }
        var idx = lsIndex().filter(function (m) { return m.id !== id; });
        var m2 = {}; Object.keys(meta).forEach(function (k) { m2[k] = meta[k]; });
        // 서버가 없을 때는 그림도 목록 안에 같이 둔다
        var old = lsIndex().filter(function (m) { return m.id === id; })[0];
        m2.thumb = thumb || (old && old.thumb) || '';
        idx.unshift(m2);
        lsSetIndex(idx);
        return Promise.resolve({ id: id });
      }
      return fetch('/api/project/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id, meta: meta, data: data, thumb: thumb || '' })
      }).then(function (r) { return r.json(); })
        .then(function (d) { if (!d.ok) throw new Error(d.error || '저장 실패'); return d; });
    },

    remove: function (id) {
      if (!online()) {
        try { localStorage.removeItem(LS_PROJ + id); } catch (e) { /* noop */ }
        lsSetIndex(lsIndex().filter(function (m) { return m.id !== id; }));
        return Promise.resolve({ ok: true });
      }
      return fetch('/api/project/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id })
      }).then(function (r) { return r.json(); });
    }
  };

  /* 서버가 뜨기 전에 만든 프로젝트를 서버로 옮긴다. 한 번만 한다. */
  var migrated = false;
  function migrateToServer() {
    if (migrated || !online()) return Promise.resolve();
    migrated = true;
    var idx = lsIndex();
    if (!idx.length) return Promise.resolve();
    var jobs = idx.map(function (m) {
      var raw = null;
      try { raw = JSON.parse(localStorage.getItem(LS_PROJ + m.id) || 'null'); }
      catch (e) { raw = null; }
      if (!raw) return Promise.resolve();
      return Store.save(m.id, m, raw, m.thumb || '');
    });
    return Promise.all(jobs).then(function () {
      idx.forEach(function (m) {
        try { localStorage.removeItem(LS_PROJ + m.id); } catch (e) { /* noop */ }
      });
      try { localStorage.removeItem(LS_INDEX); } catch (e) { /* noop */ }
      D.info('브라우저에 있던 프로젝트 ' + idx.length + '개를 디스크로 옮겼습니다.', 'project');
    }).catch(function (e) {
      migrated = false;
      D.warn('프로젝트 옮기기 실패: ' + e.message, 'project');
    });
  }

  /* ---------- 요약 · 썸네일 -------------------------------------------- */

  function metaOf() {
    var e = E();
    // 만든 날짜가 비어 있으면 지금으로 박아 둔다. 파이프라인이 내보낸
    // 프로젝트에는 이 값이 없어서, 안 채우면 카드에 생성일이 영영 안 뜬다.
    if (!cur().createdAt) cur().createdAt = new Date().toISOString();
    /* 배경 프리셋도 영상 클립이고 상단 캡션도 자막 클립이다. 카드에는 실제로
       자른 컷과 말 자막만 세어야 편집 규모가 읽힌다. */
    function roleOf(c) {
      var t = (e.tracks || []).filter(function (x) { return x.id === c.trackId; })[0];
      return (t && t.role) || '';
    }
    function contentEnd() {
      return (e.clips || []).reduce(function (m, c) {
        return Math.max(m, (c.start || 0) + (c.dur || 0));
      }, 0);
    }
    var vids = e.clips.filter(function (c) {
      return c.kind === 'video' && roleOf(c) !== 'background';
    });
    var caps = e.clips.filter(function (c) {
      return c.kind === 'caption' && roleOf(c) !== 'title';
    });
    return {
      id: cur().id,
      name: cur().name || '이름 없는 프로젝트',
      createdAt: cur().createdAt || new Date().toISOString(),
      savedAt: new Date().toISOString(),
      style: cur().style || D.state.ai.styleName || '',
      duration: D.round(contentEnd(), 2),
      cuts: vids.length,
      captions: caps.length,
      notes: (D.state.editNotes || []).length,
      source: (e.assets[0] || {}).name || '',
      assets: e.assets.length
    };
  }

  /* 카드 그림. 미리보기 화면을 그대로 굽는다 - 배경, 영상 띠, 자막까지
     같은 자리에 그려서 카드만 보고도 어느 편집인지 알아보게 한다.

     자리는 계산하지 않고 화면에 있는 것을 그대로 읽는다. 미리보기가 이미
     화면 자리와 크롭을 반영해 놓았으므로, 그 상자들의 좌표를 재서 옮기면
     같은 그림이 나온다. (예전에는 레이아웃 설정에서 자리를 다시 계산했는데,
     배경과 상단 캡션이 클립이 되면서 그 값들이 없어졌다.) */
  function captureThumb() {
    var W = 216, H = 384;                       // 9:16
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    g.fillStyle = '#0e1116';
    g.fillRect(0, 0, W, H);

    var stage = D.$('#stage');
    var vidLayer = D.$('#vidLayer');
    var subLayer = D.$('#subLayer');
    if (!stage || !vidLayer) return '';
    var sb = stage.getBoundingClientRect();
    if (!sb.width || !sb.height) return '';
    var kx = W / sb.width, ky = H / sb.height;
    var drew = false;

    try {
      /* 영상 - 뒤 트랙부터 깔린 순서 그대로 */
      var boxes = Array.prototype.slice.call(vidLayer.children).sort(function (a, b) {
        return (+a.style.zIndex || 0) - (+b.style.zIndex || 0);
      });
      boxes.forEach(function (box) {
        var v = box.querySelector('video');
        if (!v || v.readyState < 2 || !v.videoWidth) return;
        var bb = box.getBoundingClientRect();
        var vb = v.getBoundingClientRect();
        if (!bb.width || !vb.width) return;
        var dx = (bb.left - sb.left) * kx, dy = (bb.top - sb.top) * ky;
        var dw = bb.width * kx, dh = bb.height * ky;

        if (getComputedStyle(v).objectFit === 'contain') {
          /* 자리를 안 정한 클립은 비율을 지켜 넣는다 - 화면과 같게 */
          var sc = Math.min(dw / v.videoWidth, dh / v.videoHeight);
          var fw = v.videoWidth * sc, fh = v.videoHeight * sc;
          g.drawImage(v, dx + (dw - fw) / 2, dy + (dh - fh) / 2, fw, fh);
        } else {
          /* 크롭이 걸리면 영상 태그가 상자 밖으로 넘친다. 겹치는 부분이 곧
             소스에서 쓰는 부분이다. */
          var sx = (bb.left - vb.left) / vb.width * v.videoWidth;
          var sy = (bb.top - vb.top) / vb.height * v.videoHeight;
          var sw = bb.width / vb.width * v.videoWidth;
          var sh = bb.height / vb.height * v.videoHeight;
          g.drawImage(v, sx, sy, sw, sh, dx, dy, dw, dh);
        }
        drew = true;
      });

      /* 자막 - 화면에 뜬 줄을 같은 자리에 같은 모양으로 */
      if (subLayer) {
        Array.prototype.forEach.call(subLayer.children, function (line) {
          var tx = line.querySelector('.sub-text');
          if (!tx || !tx.textContent) return;
          /* 발끈 자막은 겹이 둘이다 - 뒤에 외곽선, 앞에 그라데이션 채움.
             .sub-text 를 통째로 읽으면 글자가 두 번 들어가고(같은 말이
             나란히 찍힌다) 외곽선 · 글자색은 부모가 아니라 겹에 붙어 있어
             하나도 안 걸린다. 겹이 있으면 겹에서 읽는다. */
          var face = tx.querySelector('.emph-fill') || tx;
          var edge = tx.querySelector('.emph-back') || tx;
          var text = face.textContent;
          if (!text) return;
          var tb = tx.getBoundingClientRect();
          var cs = getComputedStyle(face);
          var es = getComputedStyle(edge);
          var fs = parseFloat(cs.fontSize) * ky;
          if (!fs) return;
          g.font = cs.fontWeight + ' ' + fs + 'px ' + cs.fontFamily;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          var cx = (tb.left + tb.width / 2 - sb.left) * kx;
          var cy = (tb.top + tb.height / 2 - sb.top) * ky;
          var ow = parseFloat(es.webkitTextStrokeWidth) * ky;
          if (ow > 0) {
            g.lineWidth = ow;
            g.strokeStyle = es.webkitTextStrokeColor;
            g.lineJoin = 'round';
            g.strokeText(text, cx, cy);
          }
          /* 발끈 자막은 글자색이 투명이고 배경 그라데이션으로 칠한다.
             카드에서는 위 색 하나로 대신한다 - 작아서 어차피 구분이 안 된다. */
          var fill = cs.color;
          if (fill === 'rgba(0, 0, 0, 0)' || fill === 'transparent') {
            var m = /rgb\([^)]+\)/.exec(cs.backgroundImage || '');
            fill = m ? m[0] : '#ffffff';
          }
          g.fillStyle = fill;
          g.fillText(text, cx, cy);
          drew = true;
        });
      }

      // 아무것도 못 그렸으면 새까만 그림 대신 빈 값을 준다. 카드가 이름
      // 머리글자를 대신 띄우는 편이 검은 네모보다 알아보기 쉽다.
      if (!drew) return '';
      return cv.toDataURL('image/jpeg', 0.72);
    } catch (e) {
      // 영상 프레임을 못 읽는 경우(코덱, 아직 로딩 중). 그림 없이 저장한다.
      return '';
    }
  }

  /* ---------- 저장 · 열기 · 만들기 ------------------------------------- */

  function ensureId() {
    if (!cur().id) {
      cur().id = newId();
      cur().createdAt = new Date().toISOString();
      if (!cur().name) cur().name = '이름 없는 프로젝트';
    }
    return cur().id;
  }

  /* 프로젝트 폴더 쪽이 화면보다 새것인지 본다.

     화면에 떠 있는 것이 파일의 최신본이라는 보장이 없다. 클로드가 파이프라인
     쪽에서 다시 편집해 projects/<id>/project.json 에 써 넣으면 브라우저는
     그걸 모른 채 옛 상태를 들고 있다. 그 상태로 저장하면 방금 내보낸 편집이
     통째로 사라진다 - 실제로 그랬다. 열기 직전의 stash 가 빈 상태(자막 0 ·
     60초)를 파일 위에 덮어썼고, 열기는 그렇게 망가진 파일을 도로 읽어서
     화면에도 표가 안 났다.

     견주는 값은 **디스크에 마지막으로 읽고 쓴 시각**(P.diskAt)이지 화면의
     savedAt 이 아니다. 화면 쪽은 브라우저 자동 저장(saveLocal)이 탭을 닫을
     때마다 새 시각을 찍어서, 그걸로 견주면 언제나 "화면이 더 새것"이 되어
     이 검사가 통째로 무력해진다. 페이지를 갓 켜서 아직 아무것도 안 읽었으면
     P.diskAt 이 비어 있고, 그때는 파일 쪽을 새것으로 친다 - 열어서 읽기
     전까지는 자동 저장이 파일을 건드리지 않는다.

     savedAt 은 ISO-8601 UTC 라 글자 그대로 견주면 시각 순서가 된다. */
  function diskNewer(id) {
    if (!online() || !id) return Promise.resolve(false);
    var mine = P.diskAt || '';
    return fetch('/api/projects').then(function (r) { return r.json(); })
      .then(function (d) {
        var m = (d.projects || []).filter(function (x) { return x.id === id; })[0];
        return !!(m && m.savedAt && (!mine || m.savedAt > mine));
      }).catch(function () { return false; });
  }

  /* 저장. opt.force 는 사용자가 직접 시킨 저장이다 - 그때는 파일이 새것이어도
     사용자의 뜻대로 쓴다. 자동 저장(stash · 20초 타이머)은 시킨 적 없는
     저장이라 파일이 더 새것이면 그냥 넘어간다. */
  function save(opt) {
    opt = opt || {};
    var id = ensureId();
    if (opt.force) return doSave(id, opt);
    return diskNewer(id).then(function (newer) {
      if (!newer) return doSave(id, opt);
      D.warn('자동 저장을 건너뜁니다 - 프로젝트 폴더 쪽이 더 새것입니다. '
        + '다시 열면 새 편집을 읽어 옵니다: ' + cur().name, 'project');
      return null;
    });
  }

  function doSave(id, opt) {
    var meta = metaOf();
    var data = D.serialize();
    var thumb = opt.thumb === false ? '' : captureThumb();
    cur().savedAt = meta.savedAt;
    D.saveLocal();
    return Store.save(id, meta, data, thumb).then(function () {
      P.dirty = false;
      P.diskAt = meta.savedAt;        // 방금 우리가 쓴 것이 파일의 최신본이다
      D.state.diskAt = meta.savedAt;
      if (!opt.silent) {
        D.info('프로젝트 저장: ' + meta.name + ' (컷 ' + meta.cuts
          + ' · 자막 ' + meta.captions + ' · ' + D.fmtDur(meta.duration) + ')', 'project');
        D.toast('저장됨 - ' + meta.name);
      }
      paintChip();
      return meta;
    }).catch(function (e) {
      D.error('프로젝트 저장 실패: ' + e.message, 'project');
      throw e;
    });
  }

  /* 비어 있는 새 프로젝트의 상태. 스타일 목록은 프로젝트가 아니라 도구라서
     그대로 들고 간다 - 새 편집을 시작할 때마다 스타일을 다시 넣게 하면 안 된다. */
  function blank(name) {
    return {
      version: 1,
      /* **아이디를 미리 주지 않는다.** 주면 빈 프로젝트가 20초 자동 저장에 걸려
         폴더에 생긴다 - 사용자가 지워도 첫 화면을 열 때마다 "첫 프로젝트" 가 다시
         생겼다 (2026-09-28 지적). 아이디는 실제로 저장할 때 ensureId 가 준다. */
      project: { id: '', name: name || '새 프로젝트', createdAt: new Date().toISOString() },
      layout: null,
      editNotes: [],
      ai: {
        drops: { 'analyze.src': [], 'analyze.edited': [], 'apply.target': [], 'apply.assets': [] },
        styleName: '',
        styles: D.state.ai.styles || [],
        selectedStyleId: D.state.ai.selectedStyleId || null,
        prompt: '',
        langs: D.state.ai.langs || [],
        outputMode: 'each',
        policy: D.state.ai.policy || 'on-demand'
      },
      editor: {
        assets: [], tracks: [
          { id: D.uid('trk'), kind: 'caption', name: '자막 1', muted: false, locked: false },
          { id: D.uid('trk'), kind: 'video', name: '영상 1', muted: false, locked: false },
          { id: D.uid('trk'), kind: 'audio', name: '오디오 1', muted: false, locked: false }
        ],
        clips: [], duration: 60, pxPerSec: 60, playhead: 0, sync: true, snap: true
      }
    };
  }

  /* 지금 것에 손댄 흔적이 있으면 먼저 넣어 둔다. 프로젝트를 바꾸다가 편집을
     잃는 일이 없어야 한다.

     **손댄 흔적이 없으면 저장하지 않는다.** 예전에는 클립이 있거나 id 만
     있으면 무조건 넣어 뒀는데, 그러면 파일 쪽이 더 새것일 때 화면에 남아
     있던 옛 상태가 그 위에 덮여 쓰인다 - 클로드가 다시 편집해 내보낸 직후
     그 프로젝트를 열면 export 한 것이 통째로 되돌아갔다. 열면서 바로 다시
     읽으므로 화면에는 표도 안 났다 (자막 32장 -> 28장, 41.45초 -> 60초).
     stash 는 브라우저에서 고친 것을 지키려는 것이지 안 고친 것을 다시
     쓰려는 것이 아니다. */
  /* 손댄 것이 있는가 - 클립 · 자막 · 쪽지 · 프롬프트 · 끌어다 놓은 파일 중 하나라도.
     빈 프로젝트는 폴더에 만들지 않는다 (아이디도 아직 없다). */
  function hasContent() {
    if ((E().clips || []).length) return true;
    var r = (D.Feedback && D.Feedback.dump && D.Feedback.dump()) || D.state.review || {};
    if ((r.captions || []).length || (r.notes || []).length || (r.prompt || '').trim()) return true;
    var d = (D.state.ai && D.state.ai.drops) || {};
    return Object.keys(d).some(function (k) { return (d[k] || []).length; });
  }

  function stash() {
    if (!P.dirty) return Promise.resolve();
    if (!cur().id && !hasContent()) return Promise.resolve();
    return save({ silent: true }).catch(function () { return null; });
  }

  function create(name) {
    return stash().then(function () {
      var data = blank(name);
      D.applyState(data);
      return save({ silent: true, force: true }).then(function () {
        D.info('새 프로젝트: ' + cur().name, 'project');
        D.toast('새 프로젝트 - ' + cur().name);
        refresh();
        showManager(false);
        D.showView('ai');          // 새 프로젝트는 AI 편집 탭부터 (사용자 2026-09-29) - 피드백은 편집이 끝난 뒤의 일
      });
    });
  }

  function open(id) {
    /* 열려 있는 프로젝트를 다시 열어도 파일을 다시 읽는다. 클로드가 다시
       편집해 내보내면 같은 프로젝트의 내용이 통째로 바뀌는데, 여기서
       빠져나가면 화면이 옛 편집을 붙들고 있는다. stash 가 먼저 저장하므로
       덮어써서 잃을 것은 없다. */
    return stash().then(function () {
      return Store.read(id);
    }).then(function (data) {
      if (!data) { D.error('프로젝트를 읽지 못했습니다: ' + id, 'project'); return; }
      if (!data.project) data.project = { id: id, name: '이름 없는 프로젝트' };
      data.project.id = id;
      D.applyState(data);
      D.saveLocal();
      P.dirty = false;
      P.diskAt = data.savedAt || '';  // 방금 읽은 것이 우리가 아는 파일 상태다
      D.info('프로젝트 열기: ' + cur().name + ' (컷 '
        + E().clips.filter(function (c) { return c.kind === 'video'; }).length
        + ' · 자막 ' + E().clips.filter(function (c) { return c.kind === 'caption'; }).length + ')', 'project');
      D.toast('열림 - ' + cur().name);
      showManager(false);
      D.showView('user');
    });
  }

  function remove(id, name) {
    D.modal.open({
      title: '프로젝트 삭제',
      body: '<p class="hint"><b>' + D.esc(name) + '</b> 을(를) 목록에서 지웁니다.'
        + (online() ? ' 파일은 projects\\_trash 폴더로 옮겨 두므로 되살릴 수 있습니다.'
          : ' 브라우저에 저장된 것이라 되살릴 수 없습니다.') + '</p>',
      buttons: [
        {
          label: '삭제', class: 'btn-danger', onClick: function () {
            Store.remove(id).then(function () {
              D.info('프로젝트 삭제: ' + name, 'project');
              if (id === cur().id) {
                // 열려 있던 걸 지웠으면 빈 상태로 둔다
                D.applyState(blank('새 프로젝트'));
              }
              refresh();
            });
          }
        },
        { label: '취소' }
      ]
    });
  }

  function rename(id, name) {
    var inp = D.el('input', { class: 'inp', value: name });
    D.modal.open({
      title: '이름 바꾸기',
      body: inp,
      buttons: [
        {
          label: '바꾸기', class: 'btn-primary', onClick: function () {
            var v = inp.value.trim();
            if (!v) return false;
            if (id === cur().id) {
              cur().name = v;
              save({ silent: true, force: true }).then(refresh);
            } else {
              Store.read(id).then(function (data) {
                if (!data) return;
                data.project = data.project || {};
                data.project.name = v;
                var m = P.list.filter(function (x) { return x.id === id; })[0] || {};
                m.name = v; m.id = id;
                return Store.save(id, m, data, '');
              }).then(refresh);
            }
            D.info('이름 바꿈: ' + name + ' -> ' + v, 'project');
          }
        },
        { label: '취소' }
      ]
    });
    setTimeout(function () { inp.focus(); inp.select(); }, 30);
  }

  function duplicate(id, name) {
    Store.read(id).then(function (data) {
      if (!data) return;
      var nid = newId();
      data.project = data.project || {};
      data.project.id = nid;
      data.project.name = name + ' 사본';
      data.project.createdAt = new Date().toISOString();
      var m = P.list.filter(function (x) { return x.id === id; })[0] || {};
      var meta = {}; Object.keys(m).forEach(function (k) { meta[k] = m[k]; });
      meta.id = nid; meta.name = data.project.name;
      meta.createdAt = data.project.createdAt;
      meta.savedAt = new Date().toISOString();
      return Store.save(nid, meta, data, m.thumb && m.thumb.indexOf('data:') === 0 ? m.thumb : '');
    }).then(function () {
      D.info('프로젝트 복제: ' + name, 'project');
      refresh();
    });
  }

  /* 파일에서 가져오기. export_project.py가 만든 프로젝트 JSON도 그대로 받는다.
     그쪽은 project 항목이 없으니 파일 이름을 프로젝트 이름으로 쓴다. */
  function importFile() {
    D.pickFile('application/json,.json', false, function (files) {
      if (!files.length) return;
      D.readText(files[0]).then(function (txt) {
        var data;
        try { data = JSON.parse(txt); }
        catch (e) { D.error('프로젝트 JSON 파싱 실패: ' + e.message, 'project'); return; }
        var nm = (data.project && data.project.name)
          || files[0].name.replace(/(_project)?\.json$/i, '');
        data.project = {
          id: newId(), name: nm,
          createdAt: (data.project && data.project.createdAt) || new Date().toISOString(),
          /* 고른 스타일(styleSel)이 먼저다. styleName 은 분석할 때 적는
             이름칸이라 무엇을 골랐는지와는 다른 것이다. */
          style: (data.ai && data.ai.styleSel)
            || (data.project && data.project.style)
            || (data.ai && data.ai.styleName) || ''
        };
        stash().then(function () {
          D.applyState(data);
          return save({ silent: true, force: true });
        }).then(function () {
          D.info('프로젝트 불러옴: ' + nm + ' (' + files[0].name + ')', 'project');
          D.toast('불러옴 - ' + nm);
          refresh();
          showManager(false);
          D.showView('user');
        });
      });
    });
  }

  function exportFile() {
    var name = (cur().name || 'project').replace(/[\\/:*?"<>|]/g, '_');
    D.download(name + '_project.json', JSON.stringify(D.serialize(), null, 2), 'application/json');
  }

  /* ---------- 프로젝트 매니저 화면 -------------------------------------- */

  var filter = '';

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function ago(iso) {
    if (!iso) return '';
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (isNaN(s)) return '';
    if (s < 90) return '방금';
    if (s < 3600) return Math.round(s / 60) + '분 전';
    if (s < 86400) return Math.round(s / 3600) + '시간 전';
    if (s < 86400 * 30) return Math.round(s / 86400) + '일 전';
    return fmtDate(iso).slice(0, 10);
  }

  function card(m) {
    var isCur = m.id === cur().id;
    var el = D.el('article', { class: 'pcard' + (isCur ? ' is-current' : ''), title: m.name });

    var th = D.el('div', { class: 'pcard-thumb' });
    if (m.thumb) th.appendChild(D.el('img', { src: m.thumb, alt: '' }));
    else th.appendChild(D.el('div', { class: 'pcard-noimg', text: (m.name || '?').slice(0, 2) }));
    if (m.duration) th.appendChild(D.el('span', { class: 'pcard-dur', text: D.fmtDur(m.duration) }));
    if (isCur) th.appendChild(D.el('span', { class: 'pcard-open', text: '열려 있음' }));
    el.appendChild(th);

    var body = D.el('div', { class: 'pcard-body' }, [
      D.el('div', { class: 'pcard-name', text: m.name || '이름 없음' }),
      D.el('div', { class: 'pcard-style', text: m.style || '스타일 없음' }),
      D.el('div', {
        class: 'pcard-nums',
        text: '컷 ' + (m.cuts || 0) + ' · 자막 ' + (m.captions || 0)
          + (m.notes ? ' · 메모 ' + m.notes : '')
      }),
      D.el('div', { class: 'pcard-date', text: ago(m.savedAt), title: '수정 ' + fmtDate(m.savedAt) + '\n생성 ' + fmtDate(m.createdAt) })
    ]);
    el.appendChild(body);

    var acts = D.el('div', { class: 'pcard-acts' });
    function act(label, cls, fn) {
      var b = D.el('button', { class: 'btn btn-sm ' + (cls || ''), text: label });
      b.addEventListener('click', function (ev) { ev.stopPropagation(); fn(); });
      acts.appendChild(b);
    }
    act('열기', 'btn-primary', function () { open(m.id); });
    act('이름', '', function () { rename(m.id, m.name); });
    act('복제', '', function () { duplicate(m.id, m.name); });
    act('삭제', 'btn-danger', function () { remove(m.id, m.name); });
    el.appendChild(acts);

    el.addEventListener('dblclick', function () { open(m.id); });
    return el;
  }

  function newCard() {
    var el = D.el('article', { class: 'pcard pcard-new' }, [
      D.el('div', { class: 'pcard-plus', html: '<svg class="i i-lg"><use href="#i-plus"/></svg>' }),
      D.el('div', { class: 'pcard-name', text: '새 프로젝트' }),
      D.el('div', { class: 'pcard-style', text: '빈 타임라인으로 시작' })
    ]);
    el.addEventListener('click', promptNew);
    return el;
  }

  function paintGrid() {
    var grid = D.$('#pmGrid');
    if (!grid) return;
    grid.innerHTML = '';
    grid.appendChild(newCard());
    var f = filter.trim().toLowerCase();
    var shown = P.list.filter(function (m) {
      if (!f) return true;
      return ((m.name || '') + ' ' + (m.style || '') + ' ' + (m.source || ''))
        .toLowerCase().indexOf(f) !== -1;
    });
    shown.forEach(function (m) { grid.appendChild(card(m)); });
    if (!P.list.length) {
      grid.appendChild(D.el('div', {
        class: 'pm-empty',
        text: '프로젝트 없음'
      }));
    } else if (!shown.length) {
      grid.appendChild(D.el('div', { class: 'pm-empty', text: '"' + filter + '"에 맞는 프로젝트가 없습니다.' }));
    }
    var c = D.$('#pmCount');
    if (c) c.textContent = P.list.length + '개' + (f ? ' 중 ' + shown.length + '개 표시' : '');
    var w = D.$('#pmWhere');
    if (w) {
      w.textContent = online()
        ? '저장 위치: ' + P.where
        : '저장 위치: 브라우저 (대시보드.cmd 로 열면 디스크에 저장됩니다)';
    }
  }

  function refresh() {
    return Store.list().then(function (arr) {
      P.list = arr || [];
      paintGrid();
      paintChip();
      return P.list;
    }).catch(function (e) {
      D.warn('프로젝트 목록을 읽지 못했습니다: ' + e.message, 'project');
    });
  }

  function promptNew() {
    /* 입력 칸은 다른 칸과 같은 .input (전에는 없는 클래스 'inp' 라 브라우저 기본 모양이었다).
       Enter = 만들기 단추 (사용자 2026-09-29). 한글 조합 중 Enter 는 글자를 끝내는 것이라 건너뛴다 */
    var inp = D.el('input', { class: 'input', placeholder: '예: 고구마, 담아맷돌', value: '' });
    inp.style.marginTop = '10px';
    function make() { create(inp.value.trim() || '새 프로젝트'); }
    inp.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      make();
      D.modal.close();
    });
    D.modal.open({
      title: '새 프로젝트 추가',
      body: D.el('div', {}, [
        inp
      ]),
      buttons: [
        {
          label: '만들기', class: 'btn-primary', onClick: make
        },
        { label: '취소' }
      ]
    });
    setTimeout(function () { inp.focus(); }, 30);
  }

  var lastView = 'user';

  function showManager(on) {
    var v = D.$('#view-projects');
    if (!v) return;
    if (on) {
      var act = D.$$('.view.is-active')[0];
      if (act && act.id !== 'view-projects') lastView = act.id.replace('view-', '');
      D.$$('.view').forEach(function (x) { x.classList.toggle('is-active', x === v); });
      D.$$('.mtab').forEach(function (b) { b.classList.remove('is-active'); });
      refresh();
      var s = D.$('#pmSearch');
      if (s) setTimeout(function () { s.focus(); }, 30);
    } else if (v.classList.contains('is-active')) {
      D.showView(lastView);
    }
  }

  function isManagerOpen() {
    var v = D.$('#view-projects');
    return !!(v && v.classList.contains('is-active'));
  }

  /* ---------- 상단 바 ---------------------------------------------------- */

  function paintChip() {
    var chip = D.$('#projChip');
    if (!chip) return;
    var n = chip.querySelector('.pchip-name');
    var s = chip.querySelector('.pchip-sub');
    if (n) n.textContent = cur().name || '이름 없는 프로젝트';
    if (s) {
      s.textContent = (cur().style || D.state.ai.styleName || '스타일 없음')
        + (P.dirty ? ' · 저장 안 됨' : '');
    }
    chip.classList.toggle('is-dirty', P.dirty);
  }

  /* ---------- 메뉴 ------------------------------------------------------- */

  function bindMenu() {
    var btn = D.$('#btnMenu');
    var menu = D.$('#mainMenu');
    if (!btn || !menu) return;

    function close() { menu.hidden = true; btn.classList.remove('is-on'); }
    function toggle() {
      menu.hidden = !menu.hidden;
      btn.classList.toggle('is-on', !menu.hidden);
    }
    btn.addEventListener('click', function (ev) { ev.stopPropagation(); toggle(); });
    document.addEventListener('click', function () { if (!menu.hidden) close(); });
    menu.addEventListener('click', function (ev) { ev.stopPropagation(); });

    var acts = {
      'new': promptNew,
      manager: function () { showManager(true); },
      save: function () { save({ force: true }); },
      'export': exportFile,
      'import': importFile,
      clear: function () { D.resetProject(); }
    };
    D.$$('button[data-act]', menu).forEach(function (b) {
      b.addEventListener('click', function () {
        close();
        var f = acts[b.dataset.act];
        if (f) f();
      });
    });
  }

  /* ---------- 부팅 ------------------------------------------------------- */

  function init() {
    bindMenu();

    var pmNew = D.$('#pmNew'); if (pmNew) pmNew.addEventListener('click', promptNew);
    var pmImp = D.$('#pmImport'); if (pmImp) pmImp.addEventListener('click', importFile);
    var pmBack = D.$('#pmBack'); if (pmBack) pmBack.addEventListener('click', function () { showManager(false); });
    var pmSearch = D.$('#pmSearch');
    if (pmSearch) pmSearch.addEventListener('input', function () { filter = pmSearch.value; paintGrid(); });
    var chip = D.$('#projChip');
    if (chip) chip.addEventListener('click', function () { showManager(true); });

    // 무엇이든 바뀌면 "저장 안 됨"으로 표시하고, 잠잠해지면 조용히 넣어 둔다.
    // 브라우저 자동 저장(D.touch)만으로는 프로젝트 폴더가 옛날 것으로 남는다.
    var base = D.touch;
    var timer = null;
    D.touch = function () {
      base();
      if (!P.dirty) { P.dirty = true; paintChip(); }
      clearTimeout(timer);
      timer = setTimeout(function () {
        // 아이디가 있거나 손댄 것이 있을 때만. 빈 프로젝트를 폴더에 만들지 않는다
        if (P.dirty && (cur().id || hasContent())) save({ silent: true }).then(paintChip);
      }, 20000);
    };

    // 서버는 페이지보다 늦게 붙을 수 있다. 붙으면 브라우저에 있던 걸 옮기고
    // 목록을 다시 그린다.
    var wasOnline = online();
    setInterval(function () {
      if (online() === wasOnline) return;
      wasOnline = online();
      if (wasOnline) migrateToServer().then(refresh);
      else refresh();
    }, 2000);

    if (online()) migrateToServer().then(refresh);
    else refresh();
  }

  P.init = init;
  P.save = save;
  P.create = create;
  P.open = open;
  P.refresh = refresh;
  P.blank = blank;
  P.promptNew = promptNew;
  P.importFile = importFile;
  P.exportFile = exportFile;
  P.showManager = showManager;
  P.isManagerOpen = isManagerOpen;
  P.paintChip = paintChip;
  P.ensureId = ensureId;
  P.markClean = function () { P.dirty = false; paintChip(); };

  D.Projects = P;
})(window.D);
