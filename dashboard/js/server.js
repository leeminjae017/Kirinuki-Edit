/* server.js - 로컬 서버와의 연결.

   대시보드와 서버의 수명을 맞춘다. 페이지가 열려 있는 동안 핑을 보내고, 닫힐
   때 작별 신호를 보낸다. 서버는 붙어 있는 페이지가 없어지면 스스로 내려간다.

   서버가 있으면 작업을 jobs/ 폴더에 파일로 떨어뜨려 Claude Code가 집어가게
   하고, 없으면(정적 파일만 서비스 중이면) 예전처럼 클립보드로 넘긴다. 어느
   쪽이든 클로드 API는 부르지 않는다. */
(function (D) {
  'use strict';

  var S = {
    online: false,
    jobsDir: '',
    id: 'dash-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36),
    interval: 3000,
    timer: null,
    warned: false
  };

  function setBadge() {
    var el = D.$('#srvState');
    if (!el) return;
    el.classList.toggle('is-on', S.online);
    el.classList.toggle('is-off', !S.online);
    el.title = S.online
      ? '로컬 서버 연결됨 · 작업을 파일로 넘깁니다\n' + S.jobsDir
      : '로컬 서버 없음 · 작업을 클립보드로 넘깁니다';
    var t = el.querySelector('span');
    if (t) t.textContent = S.online ? '서버' : '서버 없음';
  }

  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* 한 번 찔러 보고 끝내면, 서버가 페이지보다 늦게 뜨거나 중간에 다시 뜬
     경우 배지가 영영 "서버 없음"으로 남는다. 그래서 상태를 물어보는 게 아니라
     핑 자체를 계속 돌린다 - 붙으면 그때 작업 폴더를 물어보고, 끊기면 다음
     핑에서 알아서 다시 붙는다. 양방향으로 스스로 맞춰진다. */
  function ping() {
    /* 숨은 탭은 타이머가 1분에 한 번까지 늦춰진다 - 숨었다고 알려 서버가 기다리게 한다 (server.py HIDDEN_TTL) */
    return post('/api/ping', { id: S.id, hidden: document.hidden }).then(function () {
      if (S.online) return;
      S.online = true;
      S.warned = false;
      setBadge();
      /* 경로로만 있는 원본(프리셋 배경 같은 것)은 서버가 붙어야 열린다.
         페이지가 먼저 뜨면 미리보기가 그것 없이 그려지므로 다시 그리게 한다. */
      D.emit('server:online');
      fetch('/api/status').then(function (r) { return r.json(); }).then(function (st) {
        S.jobsDir = st.jobsDir || '';
        if (st.pingInterval && st.pingInterval * 1000 !== S.interval) {
          S.interval = st.pingInterval * 1000;
          clearInterval(S.timer);
          S.timer = setInterval(ping, S.interval);
        }
        setBadge();
        D.info('로컬 서버에 연결되었습니다. 작업을 파일로 넘깁니다: ' + S.jobsDir, 'server');
      }).catch(function () {
        D.info('로컬 서버에 연결되었습니다.', 'server');
      });
    }).catch(function () {
      if (S.online) {
        S.online = false;
        setBadge();
        D.warn('로컬 서버 연결이 끊겼습니다. 작업은 클립보드로 넘어갑니다.', 'server');
      } else if (!S.warned) {
        S.warned = true;
        setBadge();
        D.info('정적 서버로 열렸습니다. 작업은 클립보드로 넘어갑니다. ' +
          '파일로 넘기려면 대시보드.cmd 로 여세요.', 'server');
      }
    });
  }

  S.start = function () {
    if (S.timer) clearInterval(S.timer);
    ping();
    S.timer = setInterval(ping, S.interval);

    /* 숨거나 다시 보일 때 바로 알린다 - 늦춰진 다음 핑까지 기다리면 서버가 그 사이 탭이 닫혔다고 본다.
       멈추기(freeze) 직전에도 숨었다고 한 번 더 남긴다 */
    document.addEventListener('visibilitychange', function () { ping(); });
    document.addEventListener('freeze', function () {
      try {
        navigator.sendBeacon('/api/ping',
          new Blob([JSON.stringify({ id: S.id, hidden: true })], { type: 'application/json' }));
      } catch (e) { /* 남길 곳이 없다 */ }
    });

    /* 탭을 닫거나 다른 페이지로 가면 서버에 알린다. unload는 요즘 브라우저에서
       무시될 수 있어 pagehide를 쓰고, sendBeacon이라 응답을 기다리지 않는다. */
    window.addEventListener('pagehide', function () {
      if (!S.online) return;
      try {
        navigator.sendBeacon('/api/bye',
          new Blob([JSON.stringify({ id: S.id })], { type: 'application/json' }));
      } catch (e) { /* 닫히는 중이라 남길 곳이 없다 */ }
    });
  };

  /* 작업 넘기기. 서버가 있으면 파일로, 없으면 클립보드로. */
  S.submit = function (kind, prompt, job) {
    if (!S.online) {
      D.copy(prompt, kind + ' 프롬프트');
      D.info(kind + ' 작업을 클립보드로 넘겼습니다. Claude Code에 붙여넣으면 실행됩니다.', 'handoff');
      D.toast(kind + ' 작업 복사됨 - 붙여넣으세요');
      return;
    }
    post('/api/job', { kind: kind, prompt: prompt, job: job }).then(function (r) {
      D.info(kind + ' 작업을 파일로 넘겼습니다: ' + r.job, 'handoff');
      D.toast(kind + ' 작업 저장됨 - ' + r.name);
    }).catch(function (e) {
      D.error('작업 저장 실패(' + e.message + '). 클립보드로 넘깁니다.', 'handoff');
      D.copy(prompt, kind + ' 프롬프트');
    });
  };

  /* 스타일은 프로젝트가 아니라 대시보드 전체가 쓰는 것이라 서버의
     styles/ 폴더에 둔다. 프로젝트 안에 넣어 두면 한 편에서 분석해 둔
     스타일을 다음 편집에서 못 고른다. */
  S.listStyles = function () {
    return fetch('/api/styles').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  };
  S.saveStyle = function (data) { return post('/api/style/save', { data: data }); };
  S.deleteStyle = function (file) { return post('/api/style/delete', { file: file }); };

  /* 렌더는 작업 파일이 아니라 서버가 직접 돌린다. 굽는 데 몇 분씩 걸려서
     요청은 바로 돌아오고, 진행은 물어봐야 한다. */
  S.startRender = function (body) { return post('/api/render', body); };
  S.renderStatus = function (id) {
    return fetch('/api/render/status?id=' + encodeURIComponent(id))
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
  };

  D.Server = S;
})(window.D);
