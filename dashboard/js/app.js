/* ==========================================================================
   app.js - 부팅, 탭 전환, 프로젝트 저장 / 불러오기, 단축키
   ========================================================================== */
(function (D) {
  'use strict';

  var E = D.state.editor;

  /* ---------- 탭 ---------- */
  function showView(name) {
    D.$$('.mtab').forEach(function (b) { b.classList.toggle('is-active', b.dataset.view === name); });
    D.$$('.view').forEach(function (v) { v.classList.toggle('is-active', v.id === 'view-' + name); });
    /* 숨어 있는 동안 창이 바뀌었을 수 있으므로 보이는 시점에 다시 맞춘다 */
    D.Split.reflow(true);
    if (name === 'user') { D.Feedback.refresh(); if (D.Feedback.livePreview) D.Feedback.livePreview(); }
    if (D.UserEdit) D.UserEdit.shown(name === 'edit');
  }

  /* ---------- 상태 적용 ---------- */
  function applyState(data) {
    if (!data) return;
    // 어느 프로젝트의 상태인지부터 세운다. 이게 없으면 저장이 남의 프로젝트를
    // 덮어쓴다.
    var pr = data.project || {};
    D.state.project = {
      id: pr.id || null,
      name: pr.name || '이름 없는 프로젝트',
      createdAt: pr.createdAt || null,
      savedAt: data.savedAt || null,
      style: pr.style || (data.ai && data.ai.styleName) || ''
    };
    D.state.editNotes = data.editNotes || [];
    /* 이 프로젝트에 남아 있던 로그를 되살린다. 프로젝트를 다시 열면
       지난번에 무슨 일이 있었는지가 그대로 보여야 한다. 공용 줄(부팅 ·
       서버)은 이 세션 것을 그대로 두고 이어 붙인다. */
    D.Log.setProject(data.log || []);
    D.state.render = {
      dir: (data.render && data.render.dir) || '',
      out: (data.render && data.render.out) || '',
      base: (data.render && data.render.base) || 'ko'
    };
    if (data.ai) {
      D.state.ai.drops = data.ai.drops || { 'analyze.src': [], 'analyze.edited': [], 'apply.target': [], 'apply.assets': [] };
      D.state.ai.styleName = data.ai.styleName || '';
      /* 옛 저장본에는 스타일이 프로젝트 안에 들어 있다. 그대로 두면
         AI.reloadStyles 가 창고(styles/)로 옮겨 준다. */
      D.state.ai.styles = data.ai.styles || [];
      D.state.ai.styleSel = data.ai.styleSel || '';
      D.state.ai.selectedStyleId = null;
      D.state.ai.prompt = data.ai.prompt || '';
      D.state.ai.langs = data.ai.langs || [];
      D.state.ai.outputMode = data.ai.outputMode || 'each';
      D.state.ai.policy = data.ai.policy || 'on-demand';
    }
    D.state.layout = data.layout || null;
    if (data.editor) {
      E.assets = data.editor.assets || [];
      E.tracks = data.editor.tracks || [];
      E.clips = data.editor.clips || [];
      E.duration = data.editor.duration || 60;
      E.pxPerSec = data.editor.pxPerSec || 60;
      E.playhead = data.editor.playhead || 0;
      E.sync = data.editor.sync !== false;
      E.snap = data.editor.snap !== false;
      E.selection = [];
    }

    D.AI.refresh();
    /* 피드백 탭은 클립이 아니라 완성본을 본다 - review 블록 하나면 된다 */
    D.Feedback.load(data.review || null);
    if (D.UserEdit) D.UserEdit.load(data.review || null);
    if (D.Projects) D.Projects.markClean();
    showNotes();

    // 경로가 있으면 서버가 읽어 온다. 파일도 경로도 없을 때만 문제다.
    // (불러오는 시점에는 서버 핑이 아직 안 붙었을 수 있어서 경로 유무로 본다)
    var missing = E.assets.filter(function (a) {
      return !D.files[a.fid] && !a.path;
    }).length;
    if (missing) {
      // 로컬 서버가 붙어 있으면 서버가 경로로 파일을 내주므로 다시 드랍할
      // 필요가 없다. 정적으로 열었을 때만 드랍하라고 안내한다.
      D.warn('파일 ' + missing + '개는 경로도 없어 연결할 수 없습니다. '
        + '추가 소스에 끌어다 놓으세요.', 'project');
    }
  }

  /* 이 편집에서 무엇을 왜 그렇게 했는지. 파이프라인이 넘겨준 판단을 보여
     주지 않으면 사용자가 어디를 고쳐야 할지 알 수 없다. */
  function showNotes() {
    var n = D.state.editNotes || [];
    if (!n.length) return;
    D.info('편집 내역 ' + n.length + '줄 - ' + (D.state.project.name || ''), 'project');
    n.forEach(function (t, i) { D.info('  ' + (i + 1) + '. ' + t, 'edit'); });
  }

  /* ---------- 프로젝트 ---------- */
  /* 저장은 프로젝트 저장소로 간다. 파일로 받고 싶으면 메뉴의 "파일로
     내보내기"를 쓴다 - 편집마다 파일을 손으로 챙기게 하면 안 된다. */
  /* 사람이 직접 누른 저장이다. force 없이 부르면 파일 쪽이 더 새것일 때
     (내가 편집을 내보낸 직후가 늘 그렇다) 소리 없이 건너뛴다 - 저장을
     눌렀는데 아무것도 안 저장되는 일이 그래서 생겼다. */
  function saveProject() { D.Projects.save({ force: true }); }

  /* 프로젝트를 지우지 않고 그 안의 편집만 비운다. 프로젝트 자체를 없애는 건
     매니저의 삭제다. */
  function resetProject() {
    D.modal.open({
      title: '이 프로젝트 비우기',
      body: '<p class="hint"><b>' + D.esc(D.state.project.name || '') + '</b> 의 타임라인 · 선택 파일 · '
        + '레이아웃 · 편집 메모를 지웁니다. 스타일 목록은 남습니다.</p>',
      buttons: [
        {
          label: '비우기', class: 'btn-danger', onClick: function () {
            E.assets.forEach(function (a) { if (a._url) URL.revokeObjectURL(a._url); });
            var blank = D.Projects.blank(D.state.project.name);
            blank.project.id = D.state.project.id;
            blank.project.createdAt = D.state.project.createdAt;
            applyState(blank);
            D.Split.reset();
            /* 사용자가 직접 비운 것이다 - 파일이 새것이어도 그 뜻대로 쓴다 */
            D.Projects.save({ silent: true, thumb: false, force: true });
            D.info('프로젝트를 비웠습니다: ' + D.state.project.name, 'project');
          }
        },
        { label: '취소' }
      ]
    });
  }

  /* ---------- 단축키 ---------- */
  function isTyping(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  function bindKeys() {
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { D.modal.close(); return; }

      // Ctrl+S 는 글을 쓰는 중에도 먹어야 한다. 아래 isTyping 아래에 두었더니
      // 피드백 칸에 지시를 적고 Ctrl+S 를 눌러도 아무 일도 안 일어났다 -
      // 적어 둔 피드백이 브라우저 안에만 남고 서버로 안 갔다.
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
        ev.preventDefault(); saveProject(); return;
      }
      if (isTyping(ev.target)) return;
      var userView = D.$('#view-user').classList.contains('is-active');
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key.toLowerCase() === 'p') {
        ev.preventDefault(); D.Projects.showManager(!D.Projects.isManagerOpen()); return;
      }
      if (D.Projects.isManagerOpen()) return;
      /* 사용자 편집 탭 (2026-10-02): 편집 프로그램 단축키는 그 탭이 받는다 */
      if (D.UserEdit && D.$('#view-edit') && D.$('#view-edit').classList.contains('is-active')) { D.UserEdit.key(ev); return; }
      if (!userView) return;

      /* 자막 고침 되돌리기 / 다시 (2026-09-29 지시). 글을 쓰는 중에는 위 isTyping 에서 빠지므로
         그 칸 안의 글자 되돌리기는 브라우저 것이 그대로 먹는다 */
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) D.Feedback.redo(); else D.Feedback.undo();
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') {
        ev.preventDefault(); D.Feedback.redo(); return;
      }

      /* 피드백 탭에서 쓰는 것은 재생과 되감기뿐이다. 클립을 자르고 붙이는
         단축키는 없앴다 - 이 화면은 편집기가 아니다. */
      var v = D.Feedback.video();
      switch (ev.key) {
        case ' ':
          ev.preventDefault(); D.Feedback.toggle(); break;
        case 'ArrowLeft':
          ev.preventDefault();
          v.currentTime = Math.max(0, v.currentTime - (ev.shiftKey ? 1 : 0.1));
          break;
        case 'ArrowRight':
          ev.preventDefault();
          v.currentTime = Math.min(v.duration || 0, v.currentTime + (ev.shiftKey ? 1 : 0.1));
          break;
        case 'Home':
          ev.preventDefault(); v.currentTime = 0; break;
        case 'End':
          ev.preventDefault(); v.currentTime = v.duration || 0; break;
        default: break;
      }
    });
  }

  /* ---------- 부팅 ---------- */
  function boot() {
    D.Log.mount();
    D.info('대시보드 시작', 'app');

    D.$$('.mtab').forEach(function (b) {
      b.addEventListener('click', function () { showView(b.dataset.view); });
    });

    D.$('#modalClose').addEventListener('click', D.modal.close);
    D.$('#modalBackdrop').addEventListener('click', function (e) {
      if (e.target === e.currentTarget) D.modal.close();
    });

    D.$('#btnLogCopy').addEventListener('click', function () { D.copy(D.Log.text(), '로그'); });
    D.$('#btnLogClear').addEventListener('click', function () { D.Log.clear(); });

    D.$('#btnProjSave').addEventListener('click', saveProject);

    D.Server.start();
    D.Projects.init();
    D.AI.mount();
    D.AI.bindServer();
    D.Feedback.mount();
    D.Split.init();
    bindKeys();

    /* 브라우저에 남은 마지막 상태를 먼저 되살린다. 프로젝트 폴더의 사본보다
       이쪽이 항상 최신이다 - 저장을 누르지 않고 탭을 닫아도 여기에는 남는다.
       그 상태에 어느 프로젝트의 것인지가 적혀 있으므로 그대로 이어서 쓴다. */
    var saved = D.loadLocal();
    if (saved && saved.editor && (saved.editor.clips || []).length) {
      applyState(saved);
      D.info('이어서 편집합니다: ' + D.state.project.name
        + ' (' + (saved.savedAt || '').slice(0, 19).replace('T', ' ') + ')', 'project');
      D.Projects.ensureId();
      /* **폴더 쪽이 더 새것이면 그쪽을 읽는다.** 브라우저에 남은 상태가
         언제나 최신이라는 가정이 틀릴 때가 있다 - 클로드가 다시 편집해서
         project.json 을 새로 쓰면 폴더가 앞선다. 그때 이 상태를 그대로 들고
         있으면 **피드백 탭의 자막 · 타임스탬프가 실제 영상과 어긋난다**
         (2026-09-11 지적). 지금까지는 "프로젝트 매니저에서 다시 열어
         주세요"로 넘겼는데, 그건 사용자가 알 수 없는 일이다. */
      freshenFromDisk(saved);
    } else if (saved) {
      applyState(saved);
      D.Projects.showManager(true);
    } else {
      applyState(D.Projects.blank('첫 프로젝트'));
      D.info('편집 한 편이 프로젝트 하나입니다. 메뉴에서 새 프로젝트를 만들거나 '
        + '프로젝트 매니저에서 기존 편집을 여세요.', 'app');
      D.Projects.showManager(true);
    }

    window.addEventListener('resize', function () { D.Feedback.refresh(); });
    window.addEventListener('beforeunload', D.saveLocal);
  }

  /* 폴더 것 위에 **사용자가 고친 것만** 얹는다.

     자막 고침은 시각이 아니라 **고치기 전 글(orig)** 로 제자리를 찾는다.
     판마다 컷이 바뀌어 시각이 통째로 밀리므로, 시각으로 찾으면 옆 줄을
     덮어써서 같은 글이 두 번 찍힌다. 못 찾으면 버린다 - 엉뚱한 줄을
     덮는 것보다 낫다. */
  function mergeUserBits(disk, mine) {
    var dr = disk.review || (disk.review = {});
    var mr = mine.review || {};
    if (mr.prompt) dr.prompt = mr.prompt;
    if (mr.notes && mr.notes.length) dr.notes = mr.notes;
    if (mr.drop && mr.drop.length) dr.drop = mr.drop;
    if (mr.restore && mr.restore.length) dr.restore = mr.restore;
    if (mr.ripple === false) dr.ripple = false;      // 리플 켬/끔은 사용자 설정 (2026-09-30)
    var caps = dr.captions || [];
    (mr.captions || []).forEach(function (c) {
      if (c.by !== 'user') return;
      var key = (c.orig != null ? c.orig : c.text);
      var row = null;
      for (var i = 0; i < caps.length; i++) {
        if (caps[i].text === key) { row = caps[i]; break; }
      }
      if (!row) {
        for (var j = 0; j < caps.length; j++) {
          if (caps[j].text === c.text) { row = caps[j]; break; }
        }
      }
      if (!row) return;
      row.text = c.text;
      row.by = 'user';
      if (c.orig != null) row.orig = c.orig;
      if (c.speaker) row.speaker = c.speaker;
      if (c.s2 != null) row.s2 = c.s2;
    });
    return disk;
  }

  /* 폴더의 project.json 이 브라우저에 남은 것보다 새것이면 그걸 읽어 온다.
     사용자가 고쳐 둔 것이 있으면(dirty) 건드리지 않고 알려만 준다. */
  function freshenFromDisk(saved) {
    var id = (saved.project || {}).id;
    /* **D.Server.online 은 함수가 아니라 참/거짓이다.** 전에는 online() 으로
       불러서, 부팅 때 아직 false 인 이 값 때문에 **이 함수가 한 번도 돌지
       않았다.** 그래서 "폴더가 더 새것"인 경우를 계속 놓쳤다. 서버가
       없으면 fetch 가 실패하고 catch 가 받아 준다 - 미리 따질 것 없다. */
    if (!id) return;
    fetch('/api/project?id=' + encodeURIComponent(id))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.project) return;
        var disk = d.project.savedAt || '';
        var mine = saved.diskAt || '';      // 마지막으로 읽어 온 폴더의 시각
        if (!disk || disk === mine) return;
        if (D.Projects.dirty) {
          /* **"프로젝트 매니저에서 열면 됩니다" 로 넘기지 않는다.**
             그렇게 두면 사용자는 옛 자막 목록을 계속 보면서 "'컷 편집 후'
             자막이 실제랑 다르다"고 말하게 된다 - 실제로 판을 거듭해 같은
             지적을 받았다. 대신 **합친다**: 파이프라인이 만든 것(자막 목록 ·
             컷 · 전사 · 영상)은 폴더 것을 쓰고, 사용자 것(프롬프트 · 쪽지 ·
             빼기 · 되살리기 · 손으로 고친 자막)만 얹는다. */
          mergeUserBits(d.project, saved);
          d.project.project = d.project.project || {};
          d.project.project.id = id;
          applyState(d.project);
          D.state.diskAt = disk;
          D.saveLocal();
          D.Projects.dirty = false;
          D.Projects.diskAt = disk;
          D.info('폴더가 더 새것이라 다시 읽고, 고쳐 두신 것(프롬프트 · 쪽지 · '
            + '빼기 · 되살리기 · 자막 고침)은 그대로 얹었습니다 ('
            + disk.slice(0, 19).replace('T', ' ') + ')', 'project');
          if (D.Feedback && D.Feedback.refresh) D.Feedback.refresh();
          return;
        }
        d.project.project = d.project.project || {};
        d.project.project.id = id;
        applyState(d.project);
        D.state.diskAt = disk;
        D.saveLocal();
        D.Projects.dirty = false;
        D.Projects.diskAt = disk;
        D.info('폴더가 더 새것이라 다시 읽었습니다 ('
          + disk.slice(0, 19).replace('T', ' ') + ')', 'project');
        if (D.Feedback && D.Feedback.refresh) D.Feedback.refresh();
      })
      .catch(function () { /* 못 읽으면 그냥 브라우저 상태로 간다 */ });
  }


  /* projects.js가 프로젝트를 바꿔 끼울 때 쓴다 */
  D.applyState = applyState;
  D.showView = showView;
  D.resetProject = resetProject;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window.D);
