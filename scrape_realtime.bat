@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo [%date% %time%] Task 1/3 started >> "%~dp0scrape_log.txt"
node scrape_realtime_cli.js --store tachikawa >> "%~dp0scrape_log.txt" 2>&1
echo [%date% %time%] Task 1/3 done (code: %ERRORLEVEL%) >> "%~dp0scrape_log.txt"

echo [%date% %time%] Task 2/3 started >> "%~dp0scrape_log.txt"
node scrape_realtime_cli.js --store sagamihara >> "%~dp0scrape_log.txt" 2>&1
echo [%date% %time%] Task 2/3 done (code: %ERRORLEVEL%) >> "%~dp0scrape_log.txt"

echo [%date% %time%] Task 3/3 started >> "%~dp0scrape_log.txt"
node scrape_realtime_cli.js --store kinshicho >> "%~dp0scrape_log.txt" 2>&1
echo [%date% %time%] Task 3/3 done (code: %ERRORLEVEL%) >> "%~dp0scrape_log.txt"

echo. >> "%~dp0scrape_log.txt"
