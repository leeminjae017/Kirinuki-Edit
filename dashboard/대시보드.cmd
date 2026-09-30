@echo off
REM 대시보드를 연다. 서버가 뜨고 브라우저가 열리며, 창(탭)을 닫으면 서버도
REM 스스로 내려간다. 이 검은 창은 서버가 살아 있는 동안만 남는다.
cd /d "%~dp0"
python server.py --open %*
