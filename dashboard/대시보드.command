#!/bin/bash
# 대시보드를 연다 (맥). Finder 에서 두 번 누르면 터미널 창이 뜨고 서버가 돌며
# 브라우저가 열린다. 브라우저 탭을 닫으면 서버도 스스로 내려간다.
cd "$(dirname "$0")" || exit 1
# 도구 (전사 · 검사) 가 numpy 등을 쓰므로 저장소의 .venv 가 있으면 그 파이썬으로 띄운다
PY=../.venv/bin/python
[ -x "$PY" ] || PY=python3
for t in node ffmpeg ffprobe; do
  command -v "$t" >/dev/null 2>&1 || echo "※ $t 이(가) 없습니다. brew install node ffmpeg 로 설치하세요."
done
exec "$PY" server.py --open "$@"
