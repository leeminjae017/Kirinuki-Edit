/* ==========================================================================
   ai.js - AI 편집 탭 (스타일 분석 / 스타일 적용 / 추가 프롬프트 / 로그)
   이 대시보드는 API를 호출하지 않는다. 작업 정의(JSON)와 프롬프트만 만든다.
   ========================================================================== */
(function (D) {
  'use strict';

  var AI = D.state.ai;
  var zones = {};

  /* ---------- 유틸 ---------- */
  function pathsOf(key) {
    return D.flatten(AI.drops[key] || []).map(function (n) { return n.path; });
  }
  function rootsOf(key) {
    return (AI.drops[key] || []).map(function (n) {
      return { name: n.name, path: n.path, type: n.isDir ? 'folder' : 'file', files: n.isDir ? D.countFiles(n) : 1 };
    });
  }
  function videosOf(key) {
    return D.flatten(AI.drops[key] || []).filter(function (n) { return n.kind === 'video'; });
  }
  function baseName(name) { return String(name).replace(/\.[^.]+$/, ''); }

  /* ---------- 언어 ---------- */
  function parseLangs(raw) {
    return String(raw || '')
      .split(/[,\s]+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean)
      .filter(function (v, i, a) { return a.indexOf(v) === i; })
      .slice(0, 12);
  }

  function renderLangs() {
    var wrap = D.$('#langChips');
    wrap.innerHTML = '';
    AI.langs.forEach(function (l, i) {
      var c = D.el('span', { class: 'chip' });
      c.appendChild(D.el('span', { class: 'n', text: String(i + 1) }));
      c.appendChild(D.el('span', { text: l }));
      wrap.appendChild(c);
    });
    if (!AI.langs.length) wrap.appendChild(D.el('span', { class: 'hint', text: '비워두면 자막 원본 언어 1개만 생성합니다.' }));
    renderOutputs();
  }

  /* ---------- 출력 목록 ---------- */
  function plannedOutputs() {
    var vids = videosOf('apply.target');
    var langs = AI.langs.length ? AI.langs : [''];
    var out = [];
    vids.forEach(function (v) {
      langs.forEach(function (l) {
        out.push({
          lang: l || 'original',
          file: baseName(v.name) + (l ? '_' + l : '_edit') + '.mp4',
          source: v.path
        });
      });
    });
    return out;
  }

  function renderOutputs() {
    var list = D.$('#outputList');
    if (!list) return;
    var outs = plannedOutputs();
    list.innerHTML = '';

    var sum = D.el('div', { class: 'out-summary' });
    var langCount = AI.langs.length || 1;
    sum.appendChild(D.el('span', {
      html: '대상 영상 <b>' + videosOf('apply.target').length + '</b>개 · 언어 <b>' + langCount + '</b>개'
    }));
    sum.appendChild(D.el('span', { html: '결과 영상 <b>' + outs.length + '</b>개' }));
    list.appendChild(sum);

    if (!outs.length) {
      list.appendChild(D.el('li', { class: 'hint', text: '편집 대상 폴더를 드랍하면 생성될 결과 영상이 여기에 표시됩니다.' }));
      return;
    }
    outs.slice(0, 40).forEach(function (o, i) {
      var li = D.el('li', { class: 'out-item' });
      li.appendChild(D.el('span', { class: 'idx', text: String(i + 1) }));
      li.appendChild(D.el('span', { class: 'fn', title: o.source, text: o.file }));
      li.appendChild(D.el('span', { class: 'lang', text: o.lang }));
      list.appendChild(li);
    });
    if (outs.length > 40) list.appendChild(D.el('li', { class: 'hint', text: '외 ' + (outs.length - 40) + '개' }));
  }

  /* ---------- 스타일 목록 ---------- */
  function renderStyles() {
    var ul = D.$('#styleList');
    ul.innerHTML = '';
    if (!AI.styles.length) {
      ul.appendChild(D.el('li', { class: 'empty-note', text: '등록된 스타일이 없습니다.' }));
    }
    AI.styles.forEach(function (s) {
      var li = D.el('li', { class: 'style-item' + (s.id === AI.selectedStyleId ? ' is-sel' : '') });
      var main = D.el('div', { class: 'st-main' });
      main.appendChild(D.el('div', { class: 'st-name', text: s.name }));
      main.appendChild(D.el('div', {
        class: 'st-meta',
        text: (s.status === 'ready' ? '분석 완료' : '분석 대기') + ' · ' + (s.createdAt || '').slice(0, 10)
      }));
      li.appendChild(main);

      var act = D.el('div', { class: 'st-act' });
      var view = D.el('button', { title: '내용 보기' });
      view.appendChild(D.icon('eye'));
      view.addEventListener('click', function () {
        D.modal.open({
          title: '스타일: ' + s.name,
          body: D.el('pre', { text: JSON.stringify(s, null, 2) }),
          buttons: [
            { label: 'JSON 저장', onClick: function () { D.download('style_' + s.name.replace(/\s+/g, '_') + '.json', JSON.stringify(s, null, 2), 'application/json'); } },
            { label: '닫기' }
          ]
        });
      });
      var rm = D.el('button', { class: 'rm', title: '삭제' });
      rm.appendChild(D.icon('trash'));
      rm.addEventListener('click', function () {
        /* 창고에서 지우는 것이라 다른 프로젝트에서도 사라진다. 되돌릴
           방법이 없으니 한 번 묻는다 */
        D.modal.open({
          title: '스타일 삭제',
          body: D.el('p', {
            text: '"' + s.name + '"을 지웁니다. 모든 프로젝트에서 사라지고 '
              + '되돌릴 수 없습니다.'
          }),
          buttons: [
            { label: '지우기', kind: 'danger', onClick: function () { doRemove(s); } },
            { label: '그만두기' }
          ]
        });
      });
      act.appendChild(view);
      act.appendChild(rm);
      li.appendChild(act);
      ul.appendChild(li);
    });
  }

  function doRemove(s) {
    if (AI.selectedStyleId === s.id) { AI.selectedStyleId = null; AI.styleSel = ''; }
    if (!s.file || !D.Server.online) {
      AI.styles = AI.styles.filter(function (x) { return x.id !== s.id; });
      D.warn('스타일 삭제: ' + s.name, 'style');
      refreshStyles();
      return;
    }
    D.Server.deleteStyle(s.file).then(function () {
      D.warn('스타일 삭제: ' + s.name + ' (styles/' + s.file + ')', 'style');
      return loadStyles();
    }).catch(function (e) {
      D.error('스타일을 지우지 못했습니다: ' + e.message, 'style');
    });
  }

  function renderStyleSelect() {
    var sel = D.$('#styleSelect');
    sel.innerHTML = '';
    if (!AI.styles.length) {
      sel.appendChild(D.el('option', { value: '', text: '— 등록된 스타일 없음 —' }));
      sel.disabled = true;
    } else {
      sel.disabled = false;
      AI.styles.forEach(function (s) {
        sel.appendChild(D.el('option', {
          value: s.id,
          text: s.name + (s.status === 'ready' ? '' : ' (분석 대기)')
        }));
      });
      if (!AI.selectedStyleId || !AI.styles.some(function (s) { return s.id === AI.selectedStyleId; })) {
        AI.selectedStyleId = AI.styles[0].id;
      }
      sel.value = AI.selectedStyleId;
    }
    /* 고른 것을 이름으로도 붙들어 둔다. 목록이 저절로 첫 번째로 떨어질
       때 이걸 안 적으면 프로젝트가 무엇을 골랐는지 잊어버린다. */
    var pick = AI.styles.filter(function (s) { return s.id === AI.selectedStyleId; })[0];
    AI.styleSel = pick ? pick.name : '';
    D.state.project.style = AI.styleSel;   /* 프로젝트 카드에 뜨는 이름 */
    var cur = currentStyle();
    D.$('#styleMeta').textContent = cur
      ? (cur.status === 'ready'
        ? '분석 완료된 스타일입니다. 등록일 ' + (cur.createdAt || '').slice(0, 10)
        : '아직 분석 결과가 등록되지 않았습니다. 분석 탭에서 결과 JSON을 등록하세요.')
      : '등록된 스타일이 없습니다. 스타일 분석 탭에서 먼저 등록하세요.';
  }

  function currentStyle() {
    return AI.styles.filter(function (s) { return s.id === AI.selectedStyleId; })[0] || null;
  }

  function refreshStyles() {
    renderStyles();
    renderStyleSelect();
    renderOutputs();
    D.touch();
  }

  /* ---------- 스타일 창고 ----------
     스타일은 프로젝트에 딸린 것이 아니다. 편집 한 편에서 분석해 둔 것을
     다음 편집에서 그대로 골라 쓰는 것이 스타일의 쓰임새인데, 프로젝트
     상태에 넣어 두는 바람에 프로젝트를 옮기면 목록이 비어 있었다.
     (styles/ 폴더에 파일이 넷 있는데 화면에는 하나만 떴다.)
     그래서 서버의 styles/ 폴더를 창고로 삼는다. */

  function styleFromFile(row) {
    return {
      id: 'sty:' + row.file,          // 파일 이름이 곧 자리다 - 다시 열어도 같다
      file: row.file,
      name: row.name,
      status: row.error ? 'error' : 'ready',
      createdAt: row.savedAt || '',
      error: row.error || null,
      data: row.data || null
    };
  }

  /* 서버의 스타일을 읽어 목록으로 삼는다. 프로젝트 안에만 있던 것은
     한 번 서버로 올려 두고(옛 저장본에서 넘어온 것) 다시 읽는다. */
  function loadStyles() {
    if (!D.Server.online) { refreshStyles(); return Promise.resolve(false); }
    return D.Server.listStyles().then(function (r) {
      var rows = (r && r.styles) || [];
      var have = {};
      rows.forEach(function (x) { have[x.name] = true; });
      /* 창고로 올릴 것은 '창고에서 온 적이 없는'(file 이 없는) 것뿐이다.
         이름만 견주면 방금 지운 스타일이 헌 목록에 남아 있다가 곧바로
         다시 올라가서, 지우기가 없던 일이 된다. */
      var orphans = AI.styles.filter(function (s) {
        return !s.file && s.data && s.status === 'ready' && !have[s.name];
      });
      /* 분석을 눌러 만들어 둔 '분석 대기'는 아직 내용이 없어 창고에 넣을
         수 없다. 그래도 화면에서 사라지면 안 되므로 목록에 남긴다. */
      var pending = AI.styles.filter(function (s) {
        return !s.file && s.status === 'pending' && !have[s.name];
      });
      AI.styles = rows.map(styleFromFile).concat(pending);
      if (!orphans.length) return null;
      /* 프로젝트 안에만 있던 스타일을 창고로 옮긴다. 한 번만 일어난다 */
      return Promise.all(orphans.map(function (s) {
        return D.Server.saveStyle(s.data).then(function () {
          D.info('스타일 "' + s.name + '"을 프로젝트에서 창고(styles/)로 옮겼습니다.', 'style');
        }).catch(function (e) {
          D.warn('스타일 "' + s.name + '"을 옮기지 못했습니다: ' + e.message, 'style');
        });
      })).then(function () { return D.Server.listStyles(); })
        .then(function (r2) {
          AI.styles = ((r2 && r2.styles) || []).map(styleFromFile).concat(pending);
        });
    }).then(function () {
      /* 프리셋은 영어 이름으로 바뀌었다 (2026-09-17). 프로젝트에 저장된 옛 한국어 이름은 aliases 로 찾는다 -
         못 찾아 첫 스타일로 넘어가면 그 값이 자동 저장돼 프로젝트의 스타일이 바뀐다 (봉누도2 귀신에서 한 번 그랬다) */
      var byName = AI.styles.filter(function (s) {
        return s.name === AI.styleSel || ((s.data && s.data.aliases) || []).indexOf(AI.styleSel) >= 0;
      })[0];
      AI.selectedStyleId = (byName && byName.id) || (AI.styles[0] && AI.styles[0].id) || null;
      refreshStyles();
      return true;
    }).catch(function (e) {
      D.warn('스타일 목록을 읽지 못했습니다: ' + e.message, 'style');
      refreshStyles();
      return false;
    });
  }

  /* ---------- 작업 정의 ---------- */
  function buildAnalyzeJob() {
    return {
      task: 'style.analyze',
      createdAt: new Date().toISOString(),
      style: { name: AI.styleName || '이름 없는 스타일' },
      input: {
        original: { roots: rootsOf('analyze.src'), files: pathsOf('analyze.src') },
        edited: { roots: rootsOf('analyze.edited'), files: pathsOf('analyze.edited') }
      },
      extraPrompt: AI.prompt || '',
      aiPolicy: AI.policy,
      note: '경로는 드랍한 폴더 기준 상대 경로입니다.'
    };
  }

  function buildApplyJob() {
    var s = currentStyle();
    var outs = plannedOutputs();
    return {
      task: 'style.apply',
      createdAt: new Date().toISOString(),
      style: s ? { id: s.id, name: s.name, status: s.status, data: s.data || null } : null,
      input: { roots: rootsOf('apply.target'), files: pathsOf('apply.target') },
      /* 연출에 쓸 재료. 허락 없이 인터넷에서 받지 않도록 여기 넣은 것을 먼저 쓴다 */
      assets: { roots: rootsOf('apply.assets'), files: pathsOf('apply.assets') },
      subtitleLanguages: AI.langs,
      outputs: outs,
      outputCount: outs.length,
      extraPrompt: AI.prompt || '',
      aiPolicy: AI.policy,
      note: '다국어는 자막에만 적용됩니다. 영상 · 오디오 트랙은 언어별로 동일합니다.'
    };
  }

  var SCHEMA_HINT = [
    '{',
    '  "name": "<스타일 이름>",',
    '  "cut": { "silenceThresholdDb": -34, "minSilenceSec": 0.4, "padHeadSec": 0.08, "padTailSec": 0.12, "wordBoundary": true },',
    '  "caption": { "font": "...", "sizeNorm": 0.17, "posNorm": [0.5, 0.25], "perSpeaker": { "<화자>": { "color": "#ffffff", "outline": "#000000" } } },',
    '  "audio": { "normalizeLufs": -14, "duckMusicDb": -8 },',
    '  "pacing": { "avgClipSec": 2.4, "cutsPerMin": 22 },',
    '  "notes": ["관찰한 규칙을 문장으로"]',
    '}'
  ].join('\n');

  function analyzePrompt() {
    var j = buildAnalyzeJob();
    return [
      '# 편집 스타일 분석 요청',
      '',
      '원본 영상과 그 완성 편집본을 비교해서, 재현 가능한 편집 스타일 규칙을 뽑아줘.',
      '',
      '## 원본 (' + j.input.original.files.length + '개 파일)',
      j.input.original.roots.map(function (r) { return '- ' + r.path + ' (' + r.type + ', ' + r.files + '개)'; }).join('\n') || '- (없음)',
      '',
      '## 편집본 (' + j.input.edited.files.length + '개 파일)',
      j.input.edited.roots.map(function (r) { return '- ' + r.path + ' (' + r.type + ', ' + r.files + '개)'; }).join('\n') || '- (없음)',
      '',
      '## 확인할 항목',
      '- 컷 지점 규칙: 무음 임계값, 최소 무음 길이, 앞뒤 여유, 단어 경계 보존 여부',
      '- 자막: 폰트 / 크기 / 위치 / 화자별 색상, 줄바꿈 기준, 노출 시간',
      '- 오디오: 라우드니스, 배경음 덕킹, 효과음 사용 지점',
      '- 페이싱: 평균 클립 길이, 분당 컷 수, 인트로 · 아웃트로 처리',
      '',
      AI.prompt ? '## 추가 지시\n' + AI.prompt + '\n' : '',
      '## 출력 형식',
      '아래 JSON 한 덩어리만 출력해줘. 대시보드의 "분석 결과 등록"에 그대로 붙여넣는다.',
      '',
      '```json',
      SCHEMA_HINT,
      '```'
    ].join('\n');
  }

  function applyPrompt() {
    var j = buildApplyJob();
    var langLine = AI.langs.length
      ? '자막 언어: ' + AI.langs.join(', ') + ' (언어 수만큼 결과 영상을 만든다. 영상 · 오디오는 동일, 자막만 교체)'
      : '자막 언어: 원본 1종';
    return [
      '# 편집 스타일 적용 요청',
      '',
      '아래 스타일 규칙을 편집 대상에 적용해서 편집본을 만들어줘.',
      '',
      '## 스타일',
      j.style ? '- ' + j.style.name + (j.style.status === 'ready' ? '' : ' (분석 결과 미등록)') : '- (선택된 스타일 없음)',
      j.style && j.style.data ? '```json\n' + JSON.stringify(j.style.data, null, 2) + '\n```' : '',
      '',
      '## 대상 (' + j.input.files.length + '개 파일)',
      j.input.roots.map(function (r) { return '- ' + r.path + ' (' + r.type + ', ' + r.files + '개)'; }).join('\n') || '- (없음)',
      '',
      j.assets.files.length ? '## 소스 파일 (' + j.assets.files.length + '개) - 그림 · 사진 · 효과음은 여기 것을 먼저 쓴다\n'
        + j.assets.files.slice(0, 40).map(function (f) { return '- ' + f; }).join('\n')
        + (j.assets.files.length > 40 ? '\n- 외 ' + (j.assets.files.length - 40) + '개' : '') + '\n' : '',
      '## 출력 (' + j.outputCount + '개)',
      langLine,
      j.outputs.slice(0, 20).map(function (o) { return '- ' + o.file + '  <- ' + o.source + '  [' + o.lang + ']'; }).join('\n'),
      j.outputs.length > 20 ? '- 외 ' + (j.outputs.length - 20) + '개' : '',
      '',
      AI.prompt ? '## 추가 지시\n' + AI.prompt + '\n' : '',
      '## 실행 원칙',
      '- AI 호출 정책: ' + AI.policy + ' (필요한 단계에서만 모델을 쓰고, 결정적으로 처리 가능한 구간은 스크립트로 처리)',
      '- 렌더링은 마지막에 한 번만 수행한다.',
      '- 파이프라인: render/body.py (컷 · 크롭, ffmpeg QSV) -> fx.json -> render/make_scene.py -> render/render.mjs (React 오버레이 + ffmpeg 합성). 한 편마다 손으로 쓰는 것은 fx.json 뿐이다.'
    ].join('\n');
  }

  /* ---------- 검증 ---------- */
  function validateAnalyze() {
    var ok = true;
    if (!(AI.drops['analyze.src'] || []).length) { D.error('원본 파일 / 폴더가 비어 있습니다.', 'analyze'); ok = false; }
    if (!(AI.drops['analyze.edited'] || []).length) { D.error('편집본 파일 / 폴더가 비어 있습니다.', 'analyze'); ok = false; }
    if (!AI.styleName.trim()) D.warn('스타일 이름이 비어 있어 자동 이름을 사용합니다.', 'analyze');
    var sv = videosOf('analyze.src').length, ev = videosOf('analyze.edited').length;
    if (ok && sv === 0) D.warn('원본에 영상 파일이 없습니다. 파일 형식을 확인하세요.', 'analyze');
    if (ok && ev === 0) D.warn('편집본에 영상 파일이 없습니다. 파일 형식을 확인하세요.', 'analyze');
    if (ok && sv && ev && sv !== ev) D.warn('원본 ' + sv + '개 · 편집본 ' + ev + '개로 개수가 다릅니다. 짝이 맞는지 확인하세요.', 'analyze');
    return ok;
  }

  function validateApply() {
    var ok = true;
    if (!(AI.drops['apply.target'] || []).length) { D.error('편집 대상 파일 / 폴더가 비어 있습니다.', 'apply'); ok = false; }
    var s = currentStyle();
    if (!s) { D.error('적용할 스타일이 선택되지 않았습니다.', 'apply'); ok = false; }
    else if (s.status !== 'ready') D.warn('선택한 스타일에 분석 결과가 없습니다. 규칙 없이 프롬프트만 전달됩니다.', 'apply');
    if (ok && !videosOf('apply.target').length) { D.error('대상에 영상 파일이 없습니다.', 'apply'); ok = false; }
    return ok;
  }

  /* ---------- 결과 모달 ---------- */
  /* 주 버튼은 "AI에게 맡기는" 한 동작이다. 예전에는 모달을 띄워 프롬프트 복사 ·
     JSON 저장 · 닫기를 다시 물었는데, 그 두 개는 패널에 이미 버튼으로 나와
     있어서 같은 걸 두 번 묻는 꼴이었다. 지금은 누르는 즉시 붙여넣을 프롬프트가
     클립보드에 올라간다 - 대시보드가 API를 호출하지 않으니 실행 자체는 Claude
     Code가 하고, 사용자가 할 일은 붙여넣기 하나로 끝난다. */
  function handOff(kind, prompt, job) {
    D.Server.submit(kind, prompt, job);
  }

  /* ---------- 마운트 ---------- */
  D.AI = {
    mount: function () {
      /* 드롭존 */
      D.$$('.dropzone[data-dz]').forEach(function (el) {
        var key = el.dataset.dz;
        if (key === 'bin') return; /* 편집 탭에서 처리 */
        zones[key] = D.DropZone.init(el, {
          key: key,
          nodes: AI.drops[key] || [],
          onChange: function () { renderOutputs(); }
        });
      });

      /* 서브 탭 */
      D.$$('.stab').forEach(function (btn) {
        btn.addEventListener('click', function () {
          D.$$('.stab').forEach(function (b) { b.classList.toggle('is-active', b === btn); });
          D.$$('.stab-body').forEach(function (b) {
            b.classList.toggle('is-active', b.dataset.stabBody === btn.dataset.stab);
          });
        });
      });

      /* 추가 프롬프트 */
      var pt = D.$('#extraPrompt');
      pt.value = AI.prompt || '';
      function syncPrompt() {
        AI.prompt = pt.value;
        D.$('#promptChars').textContent = pt.value.length;
        D.$('#promptTokens').textContent = Math.ceil(pt.value.length / 2.4);
        D.touch();
      }
      pt.addEventListener('input', syncPrompt);
      syncPrompt();

      var li = D.$('#langInput');
      li.value = (AI.langs || []).join(', ');
      li.addEventListener('input', function () {
        AI.langs = parseLangs(li.value);
        renderLangs();
        D.touch();
      });
      li.addEventListener('change', function () {
        D.info('다국어 설정: ' + (AI.langs.length ? AI.langs.join(', ') + ' (' + AI.langs.length + '개)' : '없음') +
          ' · 결과 영상 ' + plannedOutputs().length + '개', 'lang');
      });

      var pol = D.$('#aiPolicy');
      pol.value = AI.policy;
      pol.addEventListener('change', function () {
        AI.policy = pol.value;
        D.info('AI 호출 정책: ' + pol.options[pol.selectedIndex].text, 'ai');
        D.touch();
      });

      /* 스타일 이름 */
      var sn = D.$('#styleName');
      sn.value = AI.styleName || '';
      sn.addEventListener('input', function () { AI.styleName = sn.value; D.touch(); });

      /* 스타일 선택 */
      D.$('#styleSelect').addEventListener('change', function (e) {
        AI.selectedStyleId = e.target.value;
        AI.styleSel = (currentStyle() || {}).name || '';
        renderStyleSelect();
        renderStyles();
        D.info('스타일 선택: ' + (currentStyle() ? currentStyle().name : '없음'), 'style');
        D.touch();
      });

      /* 분석 */
      D.$('#btnAnalyze').addEventListener('click', function () {
        D.info('스타일 분석 시작', 'analyze');
        if (!validateAnalyze()) { D.error('스타일 분석을 중단했습니다.', 'analyze'); return; }
        var job = buildAnalyzeJob();
        var name = (AI.styleName.trim() || ('스타일 ' + new Date().toLocaleDateString('ko-KR')));
        var exists = AI.styles.filter(function (s) { return s.name === name; })[0];
        if (!exists) {
          AI.styles.push({
            id: D.uid('sty'), name: name, status: 'pending',
            createdAt: new Date().toISOString(),
            source: { original: job.input.original.roots, edited: job.input.edited.roots },
            data: null
          });
          AI.selectedStyleId = AI.styles[AI.styles.length - 1].id;
          AI.styleSel = name;
          D.info('스타일 "' + name + '" 등록 (분석 대기)', 'style');
        }
        refreshStyles();
        D.info('원본 ' + job.input.original.files.length + '개 · 편집본 ' + job.input.edited.files.length + '개로 분석 작업을 정의했습니다.', 'analyze');
        handOff('스타일 분석', analyzePrompt(), job);
      });

      D.$('#btnAnalyzeSave').addEventListener('click', function () {
        D.download('job_style_analyze.json', JSON.stringify(buildAnalyzeJob(), null, 2), 'application/json');
      });

      /* 분석 결과 JSON 파일을 그대로 떨어뜨릴 수 있게 한다 - 나머지 입력이
         전부 드래그&드랍인데 여기만 붙여넣기여서 스타일 파일을 손으로 열어야
         했다. styles/ 폴더의 스타일을 그대로 끌어다 놓으면 된다. */
      D.dropTarget(D.$('#analyzeResult'), function (nodes) {
        var flat = D.flatten(nodes, []);
        var json = flat.filter(function (n) { return /\.json$/i.test(n.name); });
        if (!json.length) { D.error('JSON 파일이 아닙니다: ' + flat.map(function (n) { return n.name; }).join(', '), 'style'); return; }
        if (json.length > 1) D.warn('JSON이 ' + json.length + '개입니다. 첫 번째만 읽습니다: ' + json[0].name, 'style');
        var f = D.fileOf(json[0]);
        if (!f) { D.error('파일을 읽을 수 없습니다: ' + json[0].name, 'style'); return; }
        f.text().then(function (t) {
          D.$('#analyzeResult').value = t;
          D.info('스타일 파일을 읽었습니다: ' + json[0].name + ' (등록 버튼을 누르세요)', 'style');
        }).catch(function (e) { D.error('파일 읽기 실패: ' + e.message, 'style'); });
      });

      /* 분석 결과 등록 */
      D.$('#btnStyleRegister').addEventListener('click', function () {
        var raw = D.$('#analyzeResult').value.trim();
        if (!raw) { D.error('등록할 분석 결과 JSON이 비어 있습니다.', 'style'); return; }
        var data;
        try { data = JSON.parse(raw.replace(/^```(json)?/i, '').replace(/```$/, '').trim()); }
        catch (e) { D.error('JSON 파싱 실패: ' + e.message, 'style'); return; }
        var name = data.name || AI.styleName.trim() || ('스타일 ' + new Date().toLocaleDateString('ko-KR'));
        data.name = name;
        var known = AI.styles.some(function (s) { return s.name === name; });
        AI.styleSel = name;
        D.$('#analyzeResult').value = '';
        /* 창고(styles/ 폴더)에 넣는다. 서버가 없으면 이 페이지에서만 산다 */
        if (!D.Server.online) {
          var t = AI.styles.filter(function (s) { return s.name === name; })[0];
          if (t) { t.data = data; t.status = 'ready'; }
          else {
            t = { id: D.uid('sty'), name: name, status: 'ready',
                  createdAt: new Date().toISOString(), data: data };
            AI.styles.push(t);
          }
          AI.selectedStyleId = t.id;
          D.warn('서버가 없어 이 스타일은 이 화면에만 남습니다. 서버를 켜고 다시 등록하세요.', 'style');
          refreshStyles();
          D.toast('스타일 등록됨 (임시)');
          return;
        }
        D.Server.saveStyle(data).then(function (r) {
          D.info('스타일 "' + name + '" ' + (known ? '갱신' : '신규 등록')
            + ' → styles/' + r.file, 'style');
          return loadStyles();
        }).then(function () {
          D.toast('스타일 등록됨');
        }).catch(function (e) {
          D.error('스타일을 저장하지 못했습니다: ' + e.message, 'style');
        });
      });

      /* 적용 */
      D.$('#btnApply').addEventListener('click', function () {
        D.info('스타일 적용 시작', 'apply');
        if (!validateApply()) { D.error('스타일 적용을 중단했습니다.', 'apply'); return; }
        var job = buildApplyJob();
        D.info('대상 영상 ' + videosOf('apply.target').length + '개 · 자막 언어 ' + (AI.langs.length || 1) +
          '개 → 결과 영상 ' + job.outputCount + '개', 'apply');
        if (AI.langs.length > 3) D.warn('언어가 ' + AI.langs.length + '개입니다. 렌더 시간이 언어 수에 비례합니다.', 'apply');
        handOff('스타일 적용', applyPrompt(), job);
      });

      D.$('#btnApplySave').addEventListener('click', function () {
        D.download('job_style_apply.json', JSON.stringify(buildApplyJob(), null, 2), 'application/json');
      });

      renderLangs();
      loadStyles();
    },

    refresh: function () {
      D.$('#extraPrompt').value = AI.prompt || '';
      D.$('#langInput').value = (AI.langs || []).join(', ');
      D.$('#aiPolicy').value = AI.policy;
      D.$('#styleName').value = AI.styleName || '';
      Object.keys(zones).forEach(function (k) { zones[k].set(AI.drops[k] || []); });
      renderLangs();
      loadStyles();
    },

    /* 서버가 페이지보다 늦게 붙는 일이 잦다. 붙는 순간 창고를 다시 읽는다 */
    reloadStyles: loadStyles,

    bindServer: function () {
      D.on('server:online', function () { loadStyles(); });
    }
  };

})(window.D);
