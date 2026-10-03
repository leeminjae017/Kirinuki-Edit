/* ==========================================================================
   dnd.js - 드래그 & 드랍 (파일 / 폴더 재귀 탐색) + 드롭존 UI
   ========================================================================== */
(function (D) {
  'use strict';

  var MAX_DEPTH = 8;
  var MAX_FILES = 8000;

  /* 실제 File 객체 보관소 (JSON 직렬화 대상 아님) */
  D.files = Object.create(null);

  function keepFile(file, path) {
    var fid = D.uid('f');
    D.files[fid] = file;
    return {
      id: fid, fid: fid, isDir: false,
      name: file.name,
      path: path || file.webkitRelativePath || file.name,
      size: file.size,
      kind: D.kindOf(file.name)
    };
  }
  D.keepFile = keepFile;
  D.fileOf = function (node) { return node && node.fid ? D.files[node.fid] : null; };

  /* ---------- FileSystemEntry 재귀 ---------- */
  function readAll(reader) {
    return new Promise(function (res, rej) {
      var out = [];
      (function step() {
        reader.readEntries(function (batch) {
          if (!batch.length) return res(out);
          out = out.concat(Array.prototype.slice.call(batch));
          step();
        }, rej);
      })();
    });
  }

  function walkEntry(entry, base, depth, counter) {
    var path = base ? base + '/' + entry.name : entry.name;
    if (entry.isFile) {
      return new Promise(function (res) {
        entry.file(function (f) {
          counter.n += 1;
          res(keepFile(f, path));
        }, function () { res(null); });
      });
    }
    if (entry.isDirectory) {
      if (depth >= MAX_DEPTH) {
        return Promise.resolve({ id: D.uid('d'), isDir: true, name: entry.name, path: path, children: [], truncated: true });
      }
      return readAll(entry.createReader()).then(function (list) {
        return Promise.all(list.map(function (e) {
          if (counter.n >= MAX_FILES) return Promise.resolve(null);
          return walkEntry(e, path, depth + 1, counter);
        }));
      }).then(function (children) {
        return {
          id: D.uid('d'), isDir: true, name: entry.name, path: path,
          children: children.filter(Boolean)
        };
      });
    }
    return Promise.resolve(null);
  }

  /* DataTransfer -> node[] */
  D.readDrop = function (dt) {
    var counter = { n: 0 };
    var items = dt.items ? Array.prototype.slice.call(dt.items) : [];
    var entries = items
      .filter(function (it) { return it.kind === 'file'; })
      .map(function (it) { return it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; })
      .filter(Boolean);

    if (entries.length) {
      return Promise.all(entries.map(function (e) { return walkEntry(e, '', 0, counter); }))
        .then(function (nodes) { return nodes.filter(Boolean); });
    }
    /* 폴더 API를 못 쓰는 경우 파일 목록만 */
    var files = dt.files ? Array.prototype.slice.call(dt.files) : [];
    return Promise.resolve(files.map(function (f) { return keepFile(f); }));
  };

  /* 노드 트리 평탄화 (파일만) */
  D.flatten = function (nodes, out) {
    out = out || [];
    (nodes || []).forEach(function (n) {
      if (n.isDir) D.flatten(n.children, out);
      else out.push(n);
    });
    return out;
  };

  D.countFiles = function (node) {
    return node.isDir ? D.flatten([node]).length : 1;
  };

  D.sumSize = function (nodes) {
    return D.flatten(nodes).reduce(function (a, n) { return a + (n.size || 0); }, 0);
  };

  /* ---------- 드롭존 ---------- */
  function renderZone(zone) {
    var nodes = zone._nodes;
    zone.innerHTML = '';

    if (!nodes.length) {
      var e = D.el('div', { class: 'dz-empty' });
      e.appendChild(D.icon('folder'));
      e.appendChild(D.el('span', { text: zone.dataset.hint || '파일 · 폴더' }));
      zone.appendChild(e);
    } else {
      var list = D.el('div', { class: 'dz-list' });
      nodes.forEach(function (n) {
        var item = D.el('div', { class: 'dz-item' });
        item.appendChild(D.icon(n.isDir ? 'folder' : D.KIND_ICON[n.kind] || 'file'));
        item.appendChild(D.el('span', { class: 'name', title: n.path, text: n.name }));
        item.appendChild(D.el('span', {
          class: 'meta',
          text: n.isDir ? D.countFiles(n) + '개' : D.fmtBytes(n.size)
        }));
        var rm = D.el('button', { class: 'rm', title: '제거' });
        rm.appendChild(D.icon('x'));
        rm.addEventListener('click', function () {
          zone._nodes = zone._nodes.filter(function (x) { return x !== n; });
          renderZone(zone);
          zone._sync();
          D.info('항목 제거: ' + n.name, zone.dataset.dz);
        });
        item.appendChild(rm);
        list.appendChild(item);
      });
      zone.appendChild(list);
    }

    var foot = D.el('div', { class: 'dz-foot' });
    var files = D.flatten(nodes);
    foot.appendChild(D.el('span', {
      text: nodes.length ? (nodes.length + '개 항목 · 파일 ' + files.length + '개 · ' + D.fmtBytes(D.sumSize(nodes))) : ''
    }));
    var b1 = D.el('button', { class: 'browse', text: '파일 선택' });
    b1.addEventListener('click', function () { browse(zone, false); });
    var b2 = D.el('button', { class: 'browse', text: '폴더 선택' });
    b2.addEventListener('click', function () { browse(zone, true); });
    foot.appendChild(b1);
    foot.appendChild(b2);
    zone.appendChild(foot);
  }

  function browse(zone, dir) {
    var inp = D.el('input', { type: 'file', hidden: '' });
    inp.multiple = true;
    if (dir) { inp.webkitdirectory = true; inp.directory = true; }
    inp.addEventListener('change', function () {
      var files = Array.prototype.slice.call(inp.files);
      var nodes;
      if (dir && files.length) {
        var rootName = (files[0].webkitRelativePath || '').split('/')[0] || '폴더';
        nodes = [{
          id: D.uid('d'), isDir: true, name: rootName, path: rootName,
          children: files.map(function (f) { return keepFile(f, f.webkitRelativePath || f.name); })
        }];
      } else {
        nodes = files.map(function (f) { return keepFile(f); });
      }
      addNodes(zone, nodes);
      inp.remove();
    });
    document.body.appendChild(inp);
    inp.click();
  }

  function addNodes(zone, nodes) {
    if (!nodes.length) return;
    if (!zone._multiple) zone._nodes = [];
    /* 같은 파일 (경로 · 크기) 을 다시 놓으면 옛 항목을 바꾼다 - 새로 고친 뒤 File 이 없는 항목에 다시 놓을 때 겹쳐 쌓였다 */
    var key = function (n) { return (n.isDir ? 'd:' : 'f:') + n.path + (n.isDir ? '' : ':' + n.size); };
    var cur = zone._nodes.slice();
    nodes.forEach(function (n) {
      for (var i = 0; i < cur.length; i++) if (key(cur[i]) === key(n)) { cur[i] = n; return; }
      cur.push(n);
    });
    zone._nodes = cur;
    renderZone(zone);
    zone._sync();
    var files = D.flatten(nodes);
    D.info('드랍 ' + nodes.length + '개 항목 (파일 ' + files.length + '개, ' + D.fmtBytes(D.sumSize(nodes)) + ')', zone.dataset.dz);
    if (zone._onChange) zone._onChange(zone._nodes, nodes);
  }

  /* 요소를 드롭 타깃으로 만든다 */
  D.dropTarget = function (el, onDrop, overClass) {
    var depth = 0;
    var cls = overClass || 'is-over';
    el.addEventListener('dragenter', function (ev) {
      if (!hasFiles(ev)) return;
      ev.preventDefault(); depth += 1; el.classList.add(cls);
    });
    el.addEventListener('dragover', function (ev) {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
    });
    el.addEventListener('dragleave', function () {
      depth -= 1;
      if (depth <= 0) { depth = 0; el.classList.remove(cls); }
    });
    el.addEventListener('drop', function (ev) {
      if (!hasFiles(ev)) return;
      ev.preventDefault(); ev.stopPropagation();
      depth = 0; el.classList.remove(cls);
      D.readDrop(ev.dataTransfer).then(function (nodes) {
        if (!nodes.length) { D.warn('드랍된 항목을 읽지 못했습니다.', 'dnd'); return; }
        onDrop(nodes, ev);
      }).catch(function (err) {
        D.error('드랍 처리 실패: ' + err.message, 'dnd');
      });
    });
  };

  function hasFiles(ev) {
    var dt = ev.dataTransfer;
    if (!dt) return false;
    if (dt.types && Array.prototype.indexOf.call(dt.types, 'Files') !== -1) return true;
    return !!(dt.files && dt.files.length);
  }

  D.DropZone = {
    init: function (el, opt) {
      opt = opt || {};
      el._nodes = opt.nodes || [];
      el._multiple = opt.multiple !== false;
      el._onChange = opt.onChange;
      el._sync = function () {
        if (opt.key) D.state.ai.drops[opt.key] = el._nodes;
        D.touch();
        D.emit('drops:changed', opt.key);
      };
      D.dropTarget(el, function (nodes) { addNodes(el, nodes); });
      renderZone(el);
      return {
        nodes: function () { return el._nodes; },
        set: function (n) { el._nodes = n || []; renderZone(el); el._sync(); },
        clear: function () { el._nodes = []; renderZone(el); el._sync(); }
      };
    },
    render: renderZone
  };

  /* 브라우저 전역: 드롭존 밖에 떨어뜨린 파일이 새 탭으로 열리는 것 방지 */
  window.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', function (e) { if (hasFiles(e)) e.preventDefault(); });

})(window.D);
