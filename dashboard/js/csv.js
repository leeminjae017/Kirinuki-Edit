/* ==========================================================================
   csv.js - 자막 CSV 읽기 / 쓰기
   파이프라인 포맷: start,end,speaker,text  (시간 0:00:01.02 또는 초)
   ========================================================================== */
(function (D) {
  'use strict';

  function parse(text) {
    var s = String(text || '').replace(/^﻿/, '');
    var rows = [], row = [], cell = '', q = false, i = 0;
    while (i < s.length) {
      var c = s[i];
      if (q) {
        if (c === '"') {
          if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
          q = false; i += 1; continue;
        }
        cell += c; i += 1; continue;
      }
      if (c === '"') { q = true; i += 1; continue; }
      if (c === ',') { row.push(cell); cell = ''; i += 1; continue; }
      if (c === '\r') { i += 1; continue; }
      if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 1; continue; }
      cell += c; i += 1;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.length && !(r.length === 1 && r[0].trim() === ''); });
  }

  function q(v) {
    var s = String(v === undefined || v === null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function stringify(rows) {
    return rows.map(function (r) { return r.map(q).join(','); }).join('\r\n') + '\r\n';
  }

  var ALIAS = {
    start: ['start', 'begin', 'in', 'start_time', 'starttime', '시작', '시작시간'],
    end: ['end', 'out', 'stop', 'end_time', 'endtime', '끝', '종료', '종료시간'],
    speaker: ['speaker', 'spk', 'name', 'who', '화자', '이름'],
    text: ['text', 'caption', 'subtitle', 'content', 'line', '자막', '내용', '대사'],
    id: ['id', 'idx', 'index', 'no', '번호']
  };

  function headerMap(head) {
    var map = {}, used = {};
    head.forEach(function (h, i) {
      var key = String(h || '').trim().toLowerCase().replace(/^﻿/, '');
      Object.keys(ALIAS).forEach(function (field) {
        if (used[field]) return;
        if (ALIAS[field].indexOf(key) !== -1) { map[field] = i; used[field] = true; }
      });
    });
    return map;
  }

  /* CSV 텍스트 -> 자막 행 배열 */
  function parseSubtitles(text) {
    var rows = parse(text);
    if (!rows.length) return { rows: [], warnings: ['빈 CSV입니다.'] };

    var warnings = [];
    var map = headerMap(rows[0]);
    var body;
    if (map.start !== undefined && map.text !== undefined) {
      body = rows.slice(1);
    } else {
      /* 헤더가 없으면 start,end,speaker,text 순서로 간주 */
      map = { start: 0, end: 1, speaker: 2, text: 3 };
      body = rows;
      warnings.push('헤더를 찾지 못해 start,end,speaker,text 순서로 읽었습니다.');
    }

    var out = [];
    body.forEach(function (r, n) {
      var startRaw = r[map.start];
      if (startRaw === undefined || String(startRaw).trim() === '') return;
      var start = D.parseTime(startRaw);
      var end = map.end !== undefined ? D.parseTime(r[map.end]) : start + 2;
      if (end <= start) {
        end = start + 1.5;
        warnings.push((n + 1) + '행: end가 start보다 작거나 같아 1.5초로 보정했습니다.');
      }
      out.push({
        id: map.id !== undefined ? String(r[map.id] || '').trim() : '',
        start: D.round(start, 3),
        end: D.round(end, 3),
        speaker: map.speaker !== undefined ? String(r[map.speaker] || '').trim() : '',
        text: map.text !== undefined ? String(r[map.text] || '') : ''
      });
    });
    out.sort(function (a, b) { return a.start - b.start; });
    return { rows: out, warnings: warnings };
  }

  /* 자막 클립 -> CSV 텍스트 */
  function subtitlesToCsv(clips, opt) {
    opt = opt || {};
    var rows = [];
    var head = ['start', 'end', 'speaker', 'text'];
    if (opt.withId) head.unshift('id');
    rows.push(head);
    clips.slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (c) {
      var r = [D.fmtTime(c.start), D.fmtTime(c.start + c.dur), c.speaker || '', c.text || ''];
      if (opt.withId) r.unshift(c.id);
      rows.push(r);
    });
    return '﻿' + stringify(rows);
  }

  D.CSV = {
    parse: parse,
    stringify: stringify,
    parseSubtitles: parseSubtitles,
    subtitlesToCsv: subtitlesToCsv
  };

})(window.D);
