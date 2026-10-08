/* ==========================================================================
   fonts.js - 이 컴퓨터에 깔린 폰트 목록

   자막 폰트 칸에 몇 개만 박아 두면 실제로 쓰는 폰트가 목록에 없어서 이름을
   손으로 적어야 한다. 그런데 이름을 한 글자만 틀려도 브라우저는 아무 말 없이
   기본 폰트로 떨어지고, 미리보기가 완성본과 달라진다. 상단 캡션이 그랬다 -
   렌더(libass)는 "BM JUA OTF"를 찾아내지만 브라우저가 아는 이름은
   "BM JUA_OTF"라서, 미리보기만 맑은 고딕으로 나오고 있었다.

   그래서 두 단계로 확인한다.
     1. 로컬 서버가 폰트 파일의 이름표를 읽어 후보를 준다 (/api/fonts)
     2. 여기서 후보를 하나씩 재 보고, 기본 폰트와 폭이 같으면(= 브라우저가
        못 찾은 것) 목록에서 뺀다
   그래서 목록에 뜨는 이름은 전부 실제로 그려지는 이름이다.
   ========================================================================== */
(function (D) {
  'use strict';

  var F = { list: [], ratios: {}, loaded: false, loading: null };

  /* 서버가 없을 때 쓸 최소 목록 */
  var FALLBACK = [
    'Pretendard', 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', 'Nanum Gothic',
    'Segoe UI', 'Arial', 'Georgia', 'Consolas'
  ];

  var PROBE = '한글 Ag 0123 가나다라마';

  function measure(family, text) {
    var cv = measure._cv || (measure._cv = document.createElement('canvas'));
    var g = cv.getContext('2d');
    g.font = '100px ' + family;
    return Math.round(g.measureText(text).width * 100) / 100;
  }

  /* 브라우저가 이 이름을 실제로 찾아내는가.
     document.fonts.check는 대체 폰트가 있으면 참을 돌려주므로 믿을 수 없다.
     없는 이름과 폭이 같은지로 판단한다. serif · sans-serif 두 기준으로 재서
     둘 다 같으면 못 찾은 것이다. */
  function resolves(name) {
    var q = '"' + name.replace(/"/g, '') + '"';
    var a = measure(q + ', serif', PROBE);
    var b = measure(q + ', monospace', PROBE);
    return !(a === measure('serif', PROBE) && b === measure('monospace', PROBE));
  }

  function load() {
    if (F.loading) return F.loading;
    F.loading = fetch('/api/fonts')
      .then(function (r) { return r.json(); })
      .then(function (d) { return d.fonts || []; })
      .catch(function () { return FALLBACK.map(function (n) { return { name: n, ratio: 1 }; }); })
      .then(function (rows) {
        var out = [];
        rows.forEach(function (r) {
          var n = typeof r === 'string' ? r : r.name;
          if (!resolves(n)) return;
          out.push(n);
          F.ratios[n] = (typeof r === 'object' && r.ratio) || 1;
        });
        // 서버가 없거나 하나도 못 걸렀으면 최소 목록이라도 준다
        F.list = out.length ? out : FALLBACK.filter(resolves);
        F.loaded = true;
        D.emit('fonts:loaded', F.list);
        return F.list;
      });
    return F.loading;
  }

  /* CSS 폰트 스택("A", "B", sans-serif)에서 실제로 쓰이는 첫 이름 */
  F.head = function (stack) {
    var first = String(stack || '').split(',')[0].trim();
    return first.replace(/^["']|["']$/g, '');
  };

  /* 고른 이름을 스택으로 만든다. 뒤에 대체 폰트를 붙여 두어야 그 폰트가
     없는 글자(이모지 등)도 빈칸이 되지 않는다. */
  F.stack = function (name) {
    if (!name) return 'Pretendard, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
    return '"' + name + '", Pretendard, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  };

  /* 폰트 고르는 칸. 목록이 늦게 와도 알아서 채워진다. */
  F.select = function (current, onChange) {
    var cur = F.head(current);
    var sel = D.el('select', { class: 'input' });

    function fill() {
      sel.innerHTML = '';
      var names = F.list.slice();
      if (cur && names.indexOf(cur) === -1) {
        // 지금 쓰는 이름이 이 컴퓨터에 없다. 지우지 말고 표시만 해 둔다.
        sel.appendChild(D.el('option', { value: cur, text: cur + ' (이 컴퓨터에 없음)' }));
      }
      names.forEach(function (n) { sel.appendChild(D.el('option', { value: n, text: n })); });
      sel.value = cur;
    }

    fill();
    if (!F.loaded) {
      sel.appendChild(D.el('option', { value: '__loading', text: '폰트 목록 읽는 중...' }));
      load().then(fill);
    }
    sel.addEventListener('change', function () {
      if (sel.value === '__loading') return;
      cur = sel.value;
      onChange(F.stack(cur), cur);
    });
    return sel;
  };

  /* ASS 글자 크기를 브라우저 글자 크기로 바꾸는 배율.

     libass는 Fontsize를 em 크기가 아니라 폰트 높이(winAscent+winDescent)로
     받고, CSS font-size는 em 크기다. 같은 130을 줘도 미리보기가 1.36배 크게
     나오던 이유다. 폰트마다 다르므로 폰트 파일에서 읽어 온 값을 쓴다. */
  F.ratio = function (stack) {
    var n = F.head(stack);
    return F.ratios[n] || 1;
  };

  F.load = load;
  F.resolves = resolves;
  D.Fonts = F;
})(window.D);
