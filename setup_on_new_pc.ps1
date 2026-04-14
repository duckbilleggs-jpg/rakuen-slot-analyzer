# ============================================================
# setup_on_new_pc.ps1 - 別PCでLADスクレイパーを動かすセットアップ
# 使い方: PowerShellで実行 > .\setup_on_new_pc.ps1
# ============================================================

param(
    [string]$LADRoot = "D:\Prog\PAD",
    [string]$ScraperSrc = $PSScriptRoot  # このファイルがあるフォルダ（遊技）
)

$target = Join-Path $LADRoot "exports\rakuen_scraper"

Write-Host ""
Write-Host "=== LADスクレイパー セットアップ ===" -ForegroundColor Cyan
Write-Host "コピー先: $target"
Write-Host ""

# 1. フォルダ作成
New-Item -ItemType Directory -Path $target -Force | Out-Null
Write-Host "[1] フォルダ作成完了: $target" -ForegroundColor Green

# 2. 必要ファイルをコピー
$files = @(
    "scrape_realtime_cli.js",
    "scrape_realtime.bat",         # 定期実行バッチ
    "scraper_ddelta.js",
    "scraper_ddelta_puppeteer.js", # ARROW池上など Puppeteer方式の店舗に必須
    "scraper_pscube.js",
    "scraper_maruhan.js",
    "config.json",
    "machine_lookup.js",
    "machine_db.json",
    "package.json",
    "package-lock.json"
)

foreach ($f in $files) {
    $src = Join-Path $ScraperSrc $f
    if (Test-Path $src) {
        Copy-Item $src $target -Force
        Write-Host "  コピー: $f" -ForegroundColor Green
    } else {
        if ($f -eq "scraper_ddelta_puppeteer.js") {
            Write-Host "  ⚠️ 見つからない（ARROW池上の取得が動きません）: $f" -ForegroundColor Red
        } else {
            Write-Host "  スキップ (見つからない): $f" -ForegroundColor Yellow
        }
    }
}

# 3. .envファイル (なければ雛形を作成)
$envSrc = Join-Path $ScraperSrc ".env"
$envDst = Join-Path $target ".env"
if (Test-Path $envSrc) {
    Copy-Item $envSrc $envDst -Force
    Write-Host "[2] .env コピー完了" -ForegroundColor Green
} else {
    $envContent = @"
WEB_APP_URL=https://rakuen-slot-analyzer.onrender.com
MONGODB_URI=（ここにMongoDB URIを入力）
"@
    Set-Content -Path $envDst -Value $envContent -Encoding UTF8
    Write-Host "[2] .env 雛形を作成しました。内容を確認・編集してください: $envDst" -ForegroundColor Yellow
}

# 4. npm install
Write-Host ""
Write-Host "[3] npm install 実行中..." -ForegroundColor Cyan
Push-Location $target
npm install --omit=dev 2>&1 | Tail -5
Pop-Location
Write-Host "[3] npm install 完了" -ForegroundColor Green

# 5. PADフロー内のworking_dirを更新
$flowPath = Join-Path $LADRoot "data\flows\rakuen_realtime_scrape.json"
if (Test-Path $flowPath) {
    $json = Get-Content $flowPath -Raw | ConvertFrom-Json
    foreach ($step in $json.steps) {
        if ($step.action -eq "run_command") {
            $step.params.working_dir = $target.Replace("\", "\\")
        }
    }
    $json | ConvertTo-Json -Depth 10 | Set-Content $flowPath -Encoding UTF8
    Write-Host "[4] PADフロー working_dir を更新: $target" -ForegroundColor Green
} else {
    Write-Host "[4] PADフローが見つかりません: $flowPath" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== セットアップ完了！ ===" -ForegroundColor Cyan
Write-Host "LADを起動してフロー [🎰 リアルタイムスクレイプ] を実行してください。"
Write-Host ""
