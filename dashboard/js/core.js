/* ==========================================================================
   core.js - 공통 상태, 유틸, 로그, 모달, 토스트
   ========================================================================== */
window.D = window.D || {};

(function (D) {
  'use strict';

  /* ---------- DOM 유틸 ---------- */
  D.$ = function (sel, root) { return (root || document).querySelector(sel); };
  D.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  D.el = function (tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  };

  D.icon = function (name, cls) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'i' + (cls ? ' ' + cls : ''));
    var u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    u.setAttribute('href', '#i-' + name);
    s.appendChild(u);
    return s;
  };

  D.esc = function (s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  /* ---------- 값 유틸 ---------- */
  var seq = 0;
  D.uid = function (p) { seq += 1; return (p || 'id') + '_' + Date.now().toString(36) + '_' + seq.toString(36); };
  D.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  D.round = function (v, n) { var f = Math.pow(10, n === undefined ? 3 : n); return Math.round(v * f) / f; };

  /* 0:00:00.00 */
  D.fmtTime = function (sec) {
    sec = Math.max(0, sec || 0);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = Math.floor(sec % 60);
    var cs = Math.round((sec - Math.floor(sec)) * 100);
    if (cs === 100) { cs = 0; s += 1; }
    return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
  };

  D.fmtDur = function (sec) {
    sec = Math.max(0, sec || 0);
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  };

  /* "0:00:01.02" | "1.25" | "00:01:02,300" -> 초 */
  D.parseTime = function (v) {
    if (typeof v === 'number') return v;
    var s = String(v === undefined || v === null ? '' : v).trim().replace(',', '.');
    if (s === '') return 0;
    if (s.indexOf(':') === -1) { var n = parseFloat(s); return isNaN(n) ? 0 : n; }
    var p = s.split(':').map(parseFloat);
    var out = 0;
    for (var i = 0; i < p.length; i++) out = out * 60 + (isNaN(p[i]) ? 0 : p[i]);
    return out;
  };

  D.fmtBytes = function (b) {
    if (b === undefined || b === null) return '';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  };

  D.extOf = function (name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  };

  var VIDEO_EXT = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mpg', 'mpeg', 'wmv'];
  var AUDIO_EXT = ['wav', 'mp3', 'aac', 'm4a', 'flac', 'ogg', 'opus'];
  var CAP_EXT = ['csv', 'srt', 'ass', 'vtt', 'json'];

  D.kindOf = function (name) {
    var e = D.extOf(name);
    if (VIDEO_EXT.indexOf(e) !== -1) return 'video';
    if (AUDIO_EXT.indexOf(e) !== -1) return 'audio';
    if (CAP_EXT.indexOf(e) !== -1) return 'caption';
    return 'other';
  };
  D.KIND_LABEL = { video: '영상', audio: '오디오', caption: '자막', sfx: '효과음', other: '기타' };
  D.KIND_ICON = { video: 'video', audio: 'audio', caption: 'caption', sfx: 'sfx', other: 'file' };

  /* ---------- 이벤트 버스 ---------- */
  var handlers = {};
  D.on = function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); };
  D.emit = function (ev, data) { (handlers[ev] || []).forEach(function (f) { try { f(data); } catch (e) { console.error(e); } }); };

  /* ---------- 상태 ---------- */
  D.state = {
    /* 지금 열려 있는 편집이 어느 프로젝트의 것인지. 편집은 저마다 원본도
       컷도 자막도 달라서, 한 덩어리 상태에 올려 두면 다음 편집을 시작하는
       순간 앞의 것이 덮인다. 모든 상태는 이 프로젝트에 딸린 것으로 본다. */
    project: { id: null, name: '', createdAt: null, savedAt: null, style: '' },
    /* 완성본이 어떻게 조립되는지 (프리셋 배경 · 영상 띠 · 상단 캡션).
       미리보기가 이걸 보고 같은 그림을 만든다. */
    layout: null,
    /* 이 편집에서 무엇을 왜 그렇게 했는지. 프로젝트를 다시 열었을 때
       손댈 근거가 된다. */
    editNotes: [],
    /* 이 편집을 굽는 곳과 내놓는 곳. 편집마다 다르므로 프로젝트에 딸린다.
         dir  굽는 스크립트가 있는 폴더 (import_project.py -> build_edit.py
              -> apply_captions*.py 를 서버가 여기서 돌린다)
         out  다 구운 영상이 저장될 폴더. 비우면 스크립트에 적힌 자리로 간다 */
    render: { dir: '', out: '', base: 'ko', opts: null },   // opts: 렌더 탭 설정 {codec, soft, q, size, fps, abr, lufs} (2026-10-03)
    ai: {
      drops: { 'analyze.src': [], 'analyze.edited': [], 'apply.target': [], 'apply.assets': [] },
      styleName: '',
      /* styles 는 프로젝트에 저장하지 않는다. 스타일은 편집 한 편이 아니라
         대시보드 전체가 쓰는 것이라 서버의 styles/ 폴더에 산다.
         프로젝트는 '어느 것을 골랐나'만 이름으로 기억한다 (styleSel) -
         id 는 파일 이름에서 나오므로 다른 컴퓨터에서는 뜻이 없다. */
      styles: [],
      styleSel: '',
      selectedStyleId: null,
      prompt: '',
      langs: [],
      /* 출력 방식: each = 대상 영상마다 결과 한 편, merge = 대상 영상을 순서대로 이어 결과 한 편 (언어마다) */
      outputMode: 'each',
      policy: 'on-demand'
    },
    editor: {
      assets: [],
      tracks: [],
      clips: [],
      duration: 60,
      pxPerSec: 60,
      playhead: 0,
      sync: true,
      snap: true,
      selection: [],
      /* i · o 로 찍은 잘라낼 구간. 저장하지 않는다 - 편집하는 동안만
         쓰는 표시라 다음에 열었을 때 남아 있으면 헷갈린다. */
      markIn: null,
      markOut: null
    },
    /* 피드백 탭이 쓰는 것. 완성본 · 전사본 · 태운 자막은 파이프라인이
       채워 주고(project.json 의 review), notes/prompt 는 사용자가 채운다. */
    review: { notes: [], prompt: '', lang: 'ko' },
    log: []
  };

  /* ---------- 로그 ---------- */
  var LV = { INFO: 0, WARNING: 1, ERROR: 2 };
  /* 이 꼬리표가 붙은 줄은 프로젝트를 가리지 않는다 */
  var SHARED_SRC = { server: 1, app: 1, fonts: 1 };
  D.LEVELS = LV;

  function stamp(d) {
    return String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0') + ':' +
      String(d.getSeconds()).padStart(2, '0');
  }

  /* 이모티콘 금지: 텍스트만 기록한다 */
  D.log = function (level, msg, src) {
    if (LV[level] === undefined) { src = msg; msg = level; level = 'INFO'; }
    /* 로그는 프로젝트별로 나뉜다. 줄마다 그때 열려 있던 프로젝트를 적어
       두고, 화면에는 그 프로젝트의 줄만 보여 준다. 프로젝트가 열리기 전에
       난 줄(부팅 · 서버 연결)은 pid 가 비어 있고 어느 프로젝트에서나 보인다 -
       "서버가 없어 작업이 클립보드로 간다" 같은 말은 프로젝트를 가리지
       않기 때문이다. */
    var tag = src || '';
    var now = new Date();
    var rec = {
      /* t 는 화면에 찍는 시:분:초, ts 는 줄을 세우는 데 쓰는 진짜 시각이다.
         지난번 기록과 이번 것을 한자리에 놓을 때 시:분:초만으로는 날짜가
         다른 줄이 뒤섞인다. */
      t: stamp(now), ts: now.getTime(), level: level, msg: String(msg), src: tag,
      /* 서버 · 부팅처럼 편집이 아니라 대시보드 자체에 관한 줄은 어느
         프로젝트의 것도 아니다. 어디서나 보이게 pid 를 비워 둔다. */
      pid: SHARED_SRC[tag] ? '' : ((D.state.project && D.state.project.id) || '')
    };
    D.state.log.push(rec);
    if (D.state.log.length > 2000) D.state.log.splice(0, D.state.log.length - 2000);
    D.Log.append(rec);
    D.Log.counts();
    /* 사용자 편집 화면에는 로그 판이 없다. 경고와 오류까지 안 보이면 왜 안
       되는지 알 길이 없으므로 토스트로 띄운다. 같은 말이 연달아 나오면
       (CSV를 열 때처럼) 한 번만 띄운다. */
    if (level !== 'INFO') {
      var w = D.$('#toastWrap');
      var dup = w && Array.prototype.some.call(w.children, function (n) {
        return n.textContent === rec.msg;
      });
      if (!dup) D.toast(rec.msg, level === 'ERROR' ? 'err' : 'warn');
    }
    return rec;
  };
  D.info = function (m, s) { return D.log('INFO', m, s); };
  D.warn = function (m, s) { return D.log('WARNING', m, s); };
  D.error = function (m, s) { return D.log('ERROR', m, s); };

  function logRow(rec) {
    var li = D.el('li', { class: 'log-row lv-' + rec.level });
    li.appendChild(D.el('span', { class: 't', text: rec.t }));
    li.appendChild(D.el('span', { class: 'lv', text: rec.level }));
    var m = D.el('span', { class: 'msg' });
    if (rec.src) m.appendChild(D.el('span', { class: 'src', text: '[' + rec.src + '] ' }));
    m.appendChild(document.createTextNode(rec.msg));
    li.appendChild(m);
    return li;
  }

  D.Log = {
    views: [],
    mount: function () {
      D.Log.views = D.$$('[data-log-view]');
      D.$$('.log-level').forEach(function (sel) {
        var view = sel.closest('.panel').querySelector('[data-log-view]');
        if (!view) return;
        view.dataset.minLevel = sel.value;
        sel.addEventListener('change', function () {
          view.dataset.minLevel = sel.value;
          D.Log.render(view);
        });
      });
      D.Log.views.forEach(D.Log.render);
    },
    /* 이 프로젝트에서 보여야 할 줄인가 */
    mine: function (rec) {
      return !rec.pid || rec.pid === ((D.state.project && D.state.project.id) || '');
    },
    visible: function (view, rec) {
      var min = LV[view.dataset.minLevel || 'INFO'] || 0;
      return LV[rec.level] >= min && D.Log.mine(rec);
    },
    append: function (rec) {
      D.Log.views.forEach(function (v) {
        if (!D.Log.visible(v, rec)) return;
        var sc = v.parentElement; /* 실제 스크롤 컨테이너는 .log-body */
        var atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 28;
        v.appendChild(logRow(rec));
        if (atBottom) sc.scrollTop = sc.scrollHeight;
      });
    },
    render: function (view) {
      view.innerHTML = '';
      D.state.log.forEach(function (rec) { if (D.Log.visible(view, rec)) view.appendChild(logRow(rec)); });
      view.parentElement.scrollTop = view.parentElement.scrollHeight;
    },
    counts: function () {
      var c = { INFO: 0, WARNING: 0, ERROR: 0 };
      D.state.log.forEach(function (r) {
        if (D.Log.mine(r)) c[r.level] = (c[r.level] || 0) + 1;
      });
      D.$$('[data-log-count]').forEach(function (n) {
        var k = n.dataset.logCount;
        n.textContent = k + ' ' + (c[k] || 0);
      });
    },
    /* 비우기는 지금 프로젝트의 줄만 지운다. 다른 프로젝트의 기록까지
       날아가면 되돌릴 방법이 없다. */
    clear: function () {
      var keep = D.state.log.filter(function (r) { return !D.Log.mine(r); });
      D.state.log.length = 0;
      Array.prototype.push.apply(D.state.log, keep);
      D.Log.views.forEach(function (v) { v.innerHTML = ''; });
      D.Log.counts();
    },
    /* 이 프로젝트에 저장해 둘 줄. 파일이 한없이 커지지 않게 끝의 500줄만 */
    forProject: function (pid) {
      if (!pid) return [];
      return D.state.log.filter(function (r) { return r.pid === pid; }).slice(-500);
    },
    /* 프로젝트를 바꿀 때. 이 세션의 공용 줄은 그대로 두고, 새로 연
       프로젝트의 기록을 이어 붙인 뒤 다시 그린다. */
    setProject: function (saved) {
      var shared = D.state.log.filter(function (r) { return !r.pid; });
      var all = shared.concat(saved || []);
      /* 지난 세션의 기록이 이번 세션의 줄보다 앞에 와야 한다. ts 가 없는
         것은 ts 를 넣기 전에 저장된 옛 줄이라 맨 앞으로 보낸다. */
      all.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
      D.state.log.length = 0;
      Array.prototype.push.apply(D.state.log, all);
      D.Log.views.forEach(D.Log.render);
      D.Log.counts();
    },
    text: function () {
      return D.state.log.filter(D.Log.mine).map(function (r) {
        return r.t + '  ' + r.level.padEnd(7) + '  ' + (r.src ? '[' + r.src + '] ' : '') + r.msg;
      }).join('\n');
    }
  };

  /* ---------- 토스트 ---------- */
  D.toast = function (msg, kind) {
    var wrap = D.$('#toastWrap');
    if (!wrap) return;
    var t = D.el('div', { class: 'toast' + (kind ? ' ' + kind : ''), text: msg });
    wrap.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .2s'; t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 220);
    }, 2200);
  };

  /* ---------- 모달 ---------- */
  D.modal = {
    open: function (opt) {
      var bd = D.$('#modalBackdrop');
      D.$('#modalTitle').textContent = opt.title || '';
      var body = D.$('#modalBody');
      body.innerHTML = '';
      if (typeof opt.body === 'string') body.innerHTML = opt.body;
      else if (opt.body) body.appendChild(opt.body);
      var foot = D.$('#modalFoot');
      foot.innerHTML = '';
      D.modal._cancel = opt.onCancel || null;    // 취소 · X · Esc · 바깥 누르기로 닫히면 부른다
      (opt.buttons || [{ label: '닫기' }]).forEach(function (b) {
        var btn = D.el('button', { class: 'btn ' + (b.class || ''), text: b.label });
        btn.addEventListener('click', function () {
          if (b.onClick && b.onClick() === false) return;
          if (b.onClick) D.modal._cancel = null;
          D.modal.close();
        });
        foot.appendChild(btn);
      });
      bd.hidden = false;
    },
    close: function () {
      D.$('#modalBackdrop').hidden = true;
      var c = D.modal._cancel; D.modal._cancel = null;
      if (c) c();
    }
  };

  /* ---------- 클립보드 / 다운로드 ---------- */
  D.copy = function (text, what) {
    function done() { D.toast((what || '내용') + ' 복사됨'); D.info((what || '내용') + '을(를) 클립보드로 복사했습니다.', 'clipboard'); }
    function fallback() {
      var ta = D.el('textarea', {});
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); }
      catch (e) { D.error('클립보드 복사 실패: ' + e.message, 'clipboard'); }
      ta.remove();
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
  };

  D.download = function (filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = D.el('a', { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    D.info('파일 저장: ' + filename, 'file');
  };

  D.pickFile = function (accept, multiple, cb) {
    var inp = D.el('input', { type: 'file', accept: accept || '', hidden: '' });
    if (multiple) inp.multiple = true;
    inp.addEventListener('change', function () {
      cb(Array.prototype.slice.call(inp.files));
      inp.remove();
    });
    document.body.appendChild(inp);
    inp.click();
  };

  D.readText = function (file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result)); };
      r.onerror = function () { rej(r.error); };
      r.readAsText(file, 'utf-8');
    });
  };

  /* ---------- 로컬 저장 ---------- */
  var LSKEY = 'edit-dashboard-v1';

  D.serialize = function () {
    var e = D.state.editor;
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      /* **폴더 것을 언제 읽었는지.** savedAt 은 브라우저가 저장한 시각이라
         새로고침할 때마다 지금 시각이 된다 - 그걸로 폴더와 견주면 브라우저가
         언제나 더 새것이라 **폴더가 갱신돼도 영영 안 읽는다.** 그래서 읽어 온
         폴더의 savedAt 을 따로 들고 다닌다 (app.freshenFromDisk). */
      diskAt: D.state.diskAt || '',
      project: {
        id: D.state.project.id, name: D.state.project.name,
        createdAt: D.state.project.createdAt, style: D.state.project.style || ''
      },
      layout: D.state.layout,
      editNotes: D.state.editNotes,
      log: D.Log.forProject(D.state.project.id || ''),
      render: { dir: D.state.render.dir, out: D.state.render.out, base: D.state.render.base, opts: D.state.render.opts || null },
      ai: {
        drops: D.state.ai.drops,
        styleName: D.state.ai.styleName,
        styleSel: D.state.ai.styleSel || '',
        prompt: D.state.ai.prompt,
        langs: D.state.ai.langs,
        outputMode: D.state.ai.outputMode || 'each',
        aspect: D.state.ai.aspect || '',
        policy: D.state.ai.policy
      },
      editor: {
        assets: e.assets.map(function (a) {
          return { id: a.id, kind: a.kind, name: a.name, path: a.path, size: a.size, duration: a.duration, rows: a.rows || null };
        }),
        tracks: e.tracks,
        clips: e.clips.map(function (c) {
          var o = {}; Object.keys(c).forEach(function (k) { if (k !== 'el') o[k] = c[k]; });
          return o;
        }),
        duration: e.duration, pxPerSec: e.pxPerSec, playhead: e.playhead,
        sync: e.sync, snap: e.snap
      },
      /* 피드백은 사용자가 쓴 것이라 반드시 같이 저장한다. 파이프라인이
         채워 준 부분(완성본 · 전사본 · 자막)은 Feedback.dump 가 그대로
         들고 있다가 돌려준다. */
      review: (D.Feedback && D.Feedback.dump()) || null
    };
  };

  D.saveLocal = function () {
    try { localStorage.setItem(LSKEY, JSON.stringify(D.serialize())); }
    catch (err) { D.warn('로컬 저장 실패: ' + err.message, 'storage'); }
  };

  D.loadLocal = function () {
    try {
      var raw = localStorage.getItem(LSKEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) { D.warn('로컬 불러오기 실패: ' + err.message, 'storage'); return null; }
  };

  D.clearLocal = function () { try { localStorage.removeItem(LSKEY); } catch (e) { /* noop */ } };

  /* 저장 요청은 잦으므로 묶어서 처리 */
  var saveTimer = null;
  D.touch = function () {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(D.saveLocal, 400);
  };

})(window.D);
