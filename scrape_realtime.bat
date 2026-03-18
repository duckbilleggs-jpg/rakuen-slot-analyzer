@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo [%date% %time%] リアルタイムスクレイプ開始 (立川) >> "%~dp0scrape_log.txt"
node scrape_realtime_cli.js --store tachikawa >> "%~dp0scrape_log.txt" 2>&1
echo [%date% %time%] 立川完了 (終了コード: %ERRORLEVEL%) >> "%~dp0scrape_log.txt"

echo [%date% %time%] リアルタイムスクレイプ開始 (相模原) >> "%~dp0scrape_log.txt"
node scrape_realtime_cli.js --store sagamihara >> "%~dp0scrape_log.txt" 2>&1
echo [%date% %time%] 相模原完了 (終了コード: %ERRORLEVEL%) >> "%~dp0scrape_log.txt"

echo [%date% %time%] リアルタイムスクレイプ開始 (錦糸町) >> "%~dp0scrape_log.txt"
node scrape_realtime_cli.js --store kinshicho >> "%~dp0scrape_log.txt" 2>&1
echo [%date% %time%] 錦糸町完了 (終了コード: %ERRORLEVEL%) >> "%~dp0scrape_log.txt"

echo. >> "%~dp0scrape_log.txt"
