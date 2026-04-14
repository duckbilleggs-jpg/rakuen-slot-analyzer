# ============================================================
# SSL Pinning バイパス（Fridaを使用）
# マルハンアプリがSSL Pinningを実装している場合に実行
# ============================================================

$ErrorActionPreference = "Continue"
$SDK_PATH = "$env:LOCALAPPDATA\Android\Sdk"
$ADB = "$SDK_PATH\platform-tools\adb.exe"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " SSL Pinning バイパスセットアップ" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# --- Step 1: Frida Tools インストール ---
Write-Host "`n[1/4] Frida Tools インストール..." -ForegroundColor Yellow
pip install frida-tools

# --- Step 2: エミュレータのアーキテクチャ確認＆Frida Server取得 ---
Write-Host "`n[2/4] Frida Server ダウンロード..." -ForegroundColor Yellow
$arch = & $ADB shell getprop ro.product.cpu.abi 2>$null
Write-Host "  アーキテクチャ: $arch"

$fridaVersion = (frida --version 2>$null).Trim()
Write-Host "  Frida バージョン: $fridaVersion"

$fridaServerUrl = "https://github.com/frida/frida/releases/download/$fridaVersion/frida-server-$fridaVersion-android-x86_64.xz"
$fridaServerXz = "$env:TEMP\frida-server.xz"
$fridaServerBin = "$env:TEMP\frida-server"

if (-not (Test-Path $fridaServerBin)) {
    Write-Host "  ダウンロード中: $fridaServerUrl"
    try {
        Invoke-WebRequest -Uri $fridaServerUrl -OutFile $fridaServerXz
        # xzの展開 (Python使用)
        python -c "import lzma; open('$($fridaServerBin.Replace('\','/'))', 'wb').write(lzma.open('$($fridaServerXz.Replace('\','/'))').read())"
        Write-Host "  OK: frida-server ダウンロード完了" -ForegroundColor Green
    } catch {
        Write-Host "  ⚠️ ダウンロード失敗: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "  手動で以下からダウンロードしてください:" -ForegroundColor Yellow
        Write-Host "  $fridaServerUrl"
        exit 1
    }
}

# --- Step 3: Frida Server をエミュレータに転送・起動 ---
Write-Host "`n[3/4] Frida Server をエミュレータにインストール..." -ForegroundColor Yellow
& $ADB root
Start-Sleep -Seconds 2
& $ADB push $fridaServerBin "/data/local/tmp/frida-server"
& $ADB shell "chmod 755 /data/local/tmp/frida-server"
Write-Host "  Frida Server 転送完了"

# バックグラウンドで起動
Start-Process -FilePath $ADB -ArgumentList "shell /data/local/tmp/frida-server -D" -WindowStyle Hidden
Start-Sleep -Seconds 3
Write-Host "  Frida Server 起動中..." -ForegroundColor Green

# --- Step 4: SSL Pinning バイパススクリプト ---
Write-Host "`n[4/4] SSL Pinningバイパス実行..." -ForegroundColor Yellow

# マルハンアプリのパッケージ名を取得
$packages = & $ADB shell "pm list packages | grep -i maruhan" 2>$null
Write-Host "  検出されたマルハン関連パッケージ:"
Write-Host "  $packages"

if ($packages) {
    $packageName = ($packages -split ":")[1].Trim()
    Write-Host "  ターゲット: $packageName"
    
    # Objectionでバイパス
    Write-Host ""
    Write-Host "  以下のコマンドでSSL Pinningをバイパスできます:"
    Write-Host "  frida -U -f $packageName -l scripts\frida_ssl_bypass.js --no-pause" -ForegroundColor Cyan
} else {
    Write-Host "  ⚠️ マルハンアプリが見つかりません。先にインストールしてください。" -ForegroundColor Red
}

Write-Host "`n完了。mitmwebでAPI通信を確認してください。" -ForegroundColor Green
