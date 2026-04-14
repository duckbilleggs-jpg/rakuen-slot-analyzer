# ============================================================
# マルハンアプリ API解析 セットアップスクリプト
# ============================================================
# 使い方:
#   1. PowerShellで実行: .\scripts\setup_maruhan_capture.ps1
#   2. エミュレータが起動したらマルハンアプリをインストール
#   3. アプリで川口店の台データを開く
#   4. mitmweb (ブラウザUI) でAPI通信を確認
# ============================================================

$ErrorActionPreference = "Continue"
$SDK_PATH = "$env:LOCALAPPDATA\Android\Sdk"
$ADB = "$SDK_PATH\platform-tools\adb.exe"
$EMULATOR = "$SDK_PATH\emulator\emulator.exe"
$AVD_NAME = "Pixel_7a"
$MITMPROXY_PORT = 8080

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " マルハン API解析 環境セットアップ" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# --- Step 1: mitmproxy確認 ---
Write-Host "`n[1/5] mitmproxy確認..." -ForegroundColor Yellow
$mitmCheck = where.exe mitmproxy 2>$null
if (-not $mitmCheck) {
    Write-Host "  mitmproxy未インストール。インストール中..." -ForegroundColor Red
    pip install mitmproxy
} else {
    Write-Host "  OK: $mitmCheck" -ForegroundColor Green
}

# --- Step 2: エミュレータ起動 ---
Write-Host "`n[2/5] Androidエミュレータ起動..." -ForegroundColor Yellow
Write-Host "  AVD: $AVD_NAME"

# エミュレータ起動 (プロキシ設定付き)
$hostIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -ne "127.0.0.1" } | Select-Object -First 1).IPAddress
Write-Host "  ホストIP: $hostIP (エミュレータからは 10.0.2.2 でアクセス可)"

# バックグラウンドでエミュレータ起動
$emulatorArgs = "-avd $AVD_NAME -http-proxy http://10.0.2.2:$MITMPROXY_PORT -writable-system -no-snapshot-load"
Write-Host "  コマンド: emulator $emulatorArgs"
Start-Process -FilePath $EMULATOR -ArgumentList $emulatorArgs -WindowStyle Normal

Write-Host "  エミュレータ起動中... (30秒待機)" -ForegroundColor Gray
Start-Sleep -Seconds 30

# --- Step 3: ADBでエミュレータ接続確認 ---
Write-Host "`n[3/5] ADB接続確認..." -ForegroundColor Yellow
$retries = 10
for ($i = 0; $i -lt $retries; $i++) {
    $devices = & $ADB devices 2>$null
    if ($devices -match "emulator.*device") {
        Write-Host "  OK: エミュレータ接続確認" -ForegroundColor Green
        break
    }
    Write-Host "  待機中... ($($i+1)/$retries)" -ForegroundColor Gray
    Start-Sleep -Seconds 5
}

# --- Step 4: mitmproxy CA証明書インストール ---
Write-Host "`n[4/5] mitmproxy CA証明書をエミュレータにインストール..." -ForegroundColor Yellow

# まずmitmproxyを一瞬起動してCA証明書を生成
$certPath = "$env:USERPROFILE\.mitmproxy\mitmproxy-ca-cert.cer"
if (-not (Test-Path $certPath)) {
    Write-Host "  CA証明書生成中..." -ForegroundColor Gray
    $mitmJob = Start-Process -FilePath "mitmdump" -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 3
    Stop-Process -Id $mitmJob.Id -Force -ErrorAction SilentlyContinue
}

if (Test-Path $certPath) {
    # 証明書をエミュレータにpush
    & $ADB push $certPath "/sdcard/mitmproxy-ca-cert.cer"
    Write-Host "  証明書をエミュレータに転送しました" -ForegroundColor Green
    Write-Host ""
    Write-Host "  ⚠️ 手動でCA証明書をインストールしてください:" -ForegroundColor Yellow
    Write-Host "    設定 → セキュリティ → 暗号化と認証情報 → 証明書のインストール" -ForegroundColor White
    Write-Host "    → CA証明書 → mitmproxy-ca-cert.cer を選択" -ForegroundColor White
} else {
    Write-Host "  ⚠️ CA証明書が見つかりません。mitmproxyを手動で一度起動してください" -ForegroundColor Red
}

# --- Step 5: mitmweb起動（ブラウザUI） ---
Write-Host "`n[5/5] mitmweb起動 (ブラウザUI)..." -ForegroundColor Yellow
Write-Host "  ブラウザが開きます: http://127.0.0.1:8081" -ForegroundColor Cyan
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " セットアップ完了！ 以下の手順で進めてください:" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  1. エミュレータでCA証明書をインストール（上記手順参照）"
Write-Host "  2. Google Play からマルハンアプリをインストール"
Write-Host "  3. マルハンアプリで川口店を選択 → 台データを表示"
Write-Host "  4. mitmweb (http://127.0.0.1:8081) でAPI通信を確認"
Write-Host "  5. APIリクエストのURL・ヘッダー・レスポンスをコピー"
Write-Host ""
Write-Host "  ※ 通信が見えない場合はSSL Pinningの可能性あり"
Write-Host "    → scripts\bypass_ssl_pinning.ps1 を実行してください"
Write-Host ""

# mitmweb を起動
Start-Process -FilePath "mitmweb" -ArgumentList "--listen-port $MITMPROXY_PORT --web-port 8081 --set block_global=false" -WindowStyle Normal

Write-Host "Press any key to exit..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
