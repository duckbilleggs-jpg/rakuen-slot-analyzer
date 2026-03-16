@echo off
chcp 65001 > nul
echo [%date% %time%] リアルタイムスクレイプ開始
cd /d "%~dp0"
node scrape_realtime_cli.js
echo [%date% %time%] 完了 (終了コード: %ERRORLEVEL%)
