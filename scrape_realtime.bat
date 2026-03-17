@echo off
chcp 65001 > nul
echo [%date% %time%] リアルタイムスクレイプ開始 >> "%~dp0scrape_log.txt"
cd /d "%~dp0"
node scrape_realtime_cli.js >> "%~dp0scrape_log.txt" 2>&1
echo [%date% %time%] 完了 (終了コード: %ERRORLEVEL%) >> "%~dp0scrape_log.txt"
echo. >> "%~dp0scrape_log.txt"
