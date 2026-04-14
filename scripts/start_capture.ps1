# ============================================================
# マルハン API解析 — エミュレータ + mitmweb 起動スクリプト（シンプル版）
# ============================================================

$ErrorActionPreference = "Continue"
$SDK_PATH   = "$env:LOCALAPPDATA\Android\Sdk"
$ADB        = "$SDK_PATH\platform-tools\adb.exe"
$EMULATOR   = "$SDK_PATH\emulator\emulator.exe"
$AVD_NAME   = "Pixel_7a"
$PROXY_PORT = 8080
$WEB_PORT   = 8081

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " マルハン API解析 キャプチャスタート" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Cyan

# ---- Step 1: mitmCA証明書を生成（未生成の場合） ----
$certPath = "$env:USERPROFILE\.mitmproxy\mitmproxy-ca-cert.cer"
if (-not (Test-Path $certPath)) {
    Write-Host "[1/3] CA証明書を生成中..." -ForegroundColor Yellow
    $p = Start-Process -FilePath "mitmdump" -ArgumentList "--listen-port 18080" -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 4
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

if (Test-Path $certPath) {
    Write-Host "[1/3] CA証明書: OK ($certPath)" -ForegroundColor Green
} else {
    Write-Host "[1/3] CA証明書: 未生成 (mitmwebを先に単独起動してください)" -ForegroundColor Red
}

# ---- Step 2: mitmweb 起動 ----
Write-Host "`n[2/3] mitmweb 起動中... (ポート: $PROXY_PORT, UI: $WEB_PORT)" -ForegroundColor Yellow
$mitmArgs = "--listen-port $PROXY_PORT --web-port $WEB_PORT --set block_global=false"
Start-Process -FilePath "mitmweb" -ArgumentList $mitmArgs -WindowStyle Normal
Start-Sleep -Seconds 3
Write-Host "  → ブラウザUI: http://127.0.0.1:$WEB_PORT" -ForegroundColor Cyan

# ---- Step 3: エミュレータ起動 (プロキシ=10.0.2.2:8080) ----
Write-Host "`n[3/3] Androidエミュレータ起動中... (AVD: $AVD_NAME)" -ForegroundColor Yellow
$emuArgs = "-avd $AVD_NAME -http-proxy http://10.0.2.2:$PROXY_PORT -no-snapshot-load -writable-system"
Start-Process -FilePath $EMULATOR -ArgumentList $emuArgs -WindowStyle Normal
Write-Host "  → エミュレータ起動に 30〜60秒かかります" -ForegroundColor Gray

Write-Host "`n============================================" -ForegroundColor Green
Write-Host " 起動完了！次の手順で進めてください:" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host @"

【証明書インストール手順（初回のみ）】
  1. エミュレータが起動したら ADB で確認:
       adb devices
  2. 証明書をエミュレータに転送:
       adb push "$certPath" /sdcard/mitmproxy-ca-cert.cer
  3. エミュレータ上で:
       設定 → セキュリティ → 暗号化と認証情報
       → 証明書のインストール → CA証明書
       → /sdcard/mitmproxy-ca-cert.cer を選択

【API解析手順】
  4. マルハンアプリを起動 → 川口店を選択 → 台データ表示
  5. mitmweb ( http://127.0.0.1:8081 ) でHTTPS通信を確認
  6. maruhan か hall が含まれるURLのリクエストを探す
  7. URL・ヘッダー・レスポンスJSONを scraper_maruhan.js の
     API_CONFIG に記入

【SSL Pinningでブロックされた場合】
  .\scripts\bypass_ssl_pinning.ps1

"@

# ADB接続確認（30秒後）
Write-Host "30秒後にADB接続状態を確認します..." -ForegroundColor Gray
Start-Sleep -Seconds 30
Write-Host "`n--- ADB デバイス一覧 ---" -ForegroundColor Yellow
& $ADB devices -l
