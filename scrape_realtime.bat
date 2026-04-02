@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo [%date% %time%] Task 1/5 started >> "%~dp0scrape_log.txt"
node scrape_realtime_cli.js --store tachikawa >> "%~dp0scrape_log.txt" 2>&1
echo [%date% %time%] Task 1/5 done (code: %ERRORLEVEL%) >> "%~dp0scrape_log.txt"

echo [%date% %time%] Task 2/5 started >> "%~dp0scrape_log.txt"
node scrape_realtime_cli.js --store sagamihara >> "%~dp0scrape_log.txt" 2>&1
echo [%date% %time%] Task 2/5 done (code: %ERRORLEVEL%) >> "%~dp0scrape_log.txt"

echo [%date% %time%] Task 3/5 started >> "%~dp0scrape_log.txt"
node scrape_realtime_cli.js --store kinshicho >> "%~dp0scrape_log.txt" 2>&1
echo [%date% %time%] Task 3/5 done (code: %ERRORLEVEL%) >> "%~dp0scrape_log.txt"

echo [%date% %time%] Task 4/5 started >> "%~dp0scrape_log.txt"
node scrape_realtime_cli.js --store rakuen_ikebukuro >> "%~dp0scrape_log.txt" 2>&1
echo [%date% %time%] Task 4/5 done (code: %ERRORLEVEL%) >> "%~dp0scrape_log.txt"

echo [%date% %time%] Task 5/5 started >> "%~dp0scrape_log.txt"
node scrape_realtime_cli.js --store arrow_ikegami >> "%~dp0scrape_log.txt" 2>&1
echo [%date% %time%] Task 5/5 done (code: %ERRORLEVEL%) >> "%~dp0scrape_log.txt"

echo. >> "%~dp0scrape_log.txt"
