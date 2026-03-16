/**
 * server.js — Express APIサーバー + 定期スクレイプ
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { connectDB, RealtimeCache } = require('./database');
const { scrapeToday, scrapeRecent, loadDayData, todayKey, normalizeDateKey } = require('./scraper');
const { analyzeHighSetting, analyzeAll } = require('./analyzer');
const { updateDBForNewMachines } = require('./machine_lookup');
const { scrapeDDelta } = require('./scraper_ddelta');

const app = express();
const PORT = process.env.PORT || 3000;

// Renderなど表示専用環境ではスクレイピングを無効化
const SCRAPING_DISABLED = process.env.DISABLE_SCRAPING === 'true';
if (SCRAPING_DISABLED) console.log('[Config] スクレイピング無効モード (DISABLE_SCRAPING=true)');

// 設定読み込み
function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
}

// 静的ファイル配信
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

/** 最新スクレイプ時刻の記録 */
let lastScrapeTime = null;
let scrapeStatus = 'idle'; // 'idle' | 'running' | 'error'
let lastScrapeError = null;

/** リアルタイムデータのキャッシュとステータス */
let cachedRealtimeData = [];
let lastRealtimeFetch = null;
let realtimeFetchStatus = 'idle'; // 'idle' | 'running' | 'error'
let realtimeProgress = { current: 0, total: 0, modelName: '' };

// ============================
// API エンドポイント
// ============================

/** 最新の利用可能データを取得（今日→前日→前々日とフォールバック） */
async function getLatestData() {
  for (let i = 0; i < 3; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const data = await loadDayData(key);
    if (data && data.machines && data.machines.length > 0) {
      return { data, dateKey: key };
    }
  }
  return { data: null, dateKey: null };
}

/** データが古いかチェック（6時間以上前 or 無い場合） */
async function isDataStale() {
  const { data, dateKey } = await getLatestData();
  // データ自体が無い場合は古いと判定
  if (!data) return true;
  if (!lastScrapeTime) return false;
  const elapsed = Date.now() - new Date(lastScrapeTime).getTime();
  return elapsed > 6 * 60 * 60 * 1000; // 6時間以上経過したら古い
}

app.get('/health', async (req, res) => {
  if (!SCRAPING_DISABLED && await isDataStale() && scrapeStatus !== 'running') {
    console.log('[Auto] データが古いため自動スクレイプを開始(Health Check)');
    runScrape();
  }
  res.json({ status: 'ok', lastScrape: lastScrapeTime, scrapeStatus, scrapingDisabled: SCRAPING_DISABLED });
});

/** 設定5以上の高設定台一覧 */
app.get('/api/high-setting', async (req, res) => {
  try {
    if (!SCRAPING_DISABLED && await isDataStale() && scrapeStatus !== 'running') {
      console.log('[Auto] データが古いため自動スクレイプを開始(API Request)');
      runScrape();
    }
    const { data } = await getLatestData();
    if (!data || !data.machines) {
      return res.json({ machines: [], lastScrape: lastScrapeTime, scrapeStatus, message: 'データがありません。手動取得または定期スクレイプをお待ちください。' });
    }
    const config = loadConfig();
    const now = lastScrapeTime ? new Date(lastScrapeTime) : new Date();
    const highSetting = analyzeHighSetting(data.machines, now, data.id);
    res.json({
      machines: highSetting,
      lastScrape: lastScrapeTime,
      closingTime: `${config.closingTime.hour}:${String(config.closingTime.minute).padStart(2, '0')}`,
      totalMachines: data.machines.length,
      date: data.date,
      reportId: data.id
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 全台データ */
app.get('/api/all', async (req, res) => {
  try {
    const { data } = await getLatestData();
    if (!data || !data.machines) {
      return res.json({ machines: [], lastScrape: lastScrapeTime, message: 'データがありません' });
    }
    res.json({
      machines: data.machines,
      lastScrape: lastScrapeTime,
      totalMachines: data.machines.length,
      date: data.date,
      reportId: data.id
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================
// 新規機能: リアルタイム推測 & 朝一予測
// ============================

/** リアルタイムデータ取得（d-deltanet） */
app.get('/api/realtime', async (req, res) => {
    try {
        console.log('[API] /api/realtime リクエスト受信');
        
        // キャッシュが空ならMongoDBから再読み込み
        if (cachedRealtimeData.length === 0) {
            try {
                const cached = await RealtimeCache.findOne({ key: 'latest' });
                if (cached && cached.machines && cached.machines.length > 0) {
                    cachedRealtimeData = cached.machines;
                    lastRealtimeFetch = cached.timestamp ? cached.timestamp.toISOString() : null;
                    console.log(`[API] MongoDBからリアルタイムデータ復元: ${cachedRealtimeData.length}台`);
                }
            } catch (dbErr) {
                console.log('[API] MongoDB読み込み失敗:', dbErr.message);
            }
        }

        res.json({
            machines: cachedRealtimeData,
            timestamp: lastRealtimeFetch || null,
            status: 'idle',
            progress: { current: 0, total: 0, modelName: '' },
            message: cachedRealtimeData.length > 0 
                ? `リアルタイムデータ（${cachedRealtimeData.length}台）` 
                : 'データ未取得（GitHub Actionsが営業時間中に自動取得します）'
        });
    } catch (e) {
        console.error('[API] /api/realtime エラー:', e);
        res.status(500).json({ error: e.message });
    }
});

/** 激熱予測（過去履歴からの高信頼度・高設定台ランキング） */
app.get('/api/forecast', async (req, res) => {
    try {
        console.log('[API] /api/forecast リクエスト受信');
        const { Machine } = require('./database');
        
        // 直近30日間を対象とする
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        // "YYYY-MM-DD"の形式に変換した文字列で比較
        const dateLimit = thirtyDaysAgo.toISOString().split('T')[0];

        // 過去の取得ログから「出率が設定5の基準(約108%等)を超えている」＆「稼働が5000G以上」の台を集計する
        // ※正確な設定値(1-6)は機種毎のspecsによって動的に変わるため、ここでは「出率108%以上、差枚+1500枚以上」等の基礎的な絞り込みから
        // MongoDBの集計フレームワーク(Aggregation)を利用して「どの台番が多く高設定の基準を満たしたか」をカウントする。
        const pipeline = [
            {
                // 条件1: 過去30日以内のデータ
                // 条件2: 5000G以上回っている (信頼度が高い)
                // 条件3: 出率107.5%以上 (概ね設定4後半〜5のボーダー)
                $match: {
                    dateKey: { $gte: dateLimit },
                    G数: { $gte: 4000 },
                    出率: { $gte: 107.5 }
                }
            },
            {
                // 台番・機種名ごとにグルーピングして出現回数をカウント
                $group: {
                    _id: { 機種名: "$機種名", 台番: "$台番" },
                    高設定回数: { $sum: 1 },
                    平均差枚: { $avg: "$差枚" },
                    平均出率: { $avg: "$出率" },
                    直近確認日: { $max: "$dateKey" }
                }
            },
            {
                // 高設定投入回数が多い順、同数なら平均差枚が多い順にソート
                $sort: { 高設定回数: -1, 平均差枚: -1 }
            },
            {
                $limit: 30 // 上位30台を抽出
            }
        ];

        const forecastResults = await Machine.aggregate(pipeline);

        // クライアント側で扱いやすいように整形
        const formatted = forecastResults.map(r => ({
            機種名: r._id.機種名,
            台番: r._id.台番,
            高設定回数: r.高設定回数,
            平均差枚: Math.round(r.平均差枚),
            平均出率: parseFloat(r.平均出率.toFixed(1)),
            直近確認日: r.直近確認日,
            おすすめ度: r.高設定回数 >= 3 ? '★★★ 激熱' : (r.高設定回数 >= 2 ? '★★☆ チャンス' : '★☆☆ 狙い目')
        }));

        res.json({
            machines: formatted,
            targetPeriod: '過去30日間',
            criteria: '稼働4000G以上 かつ 出率107.5%以上',
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        console.error('[API] /api/forecast エラー:', e);
        res.status(500).json({ error: e.message });
    }
});

/** 手動スクレイプ実行 */
app.post('/api/scrape', async (req, res) => {
  if (scrapeStatus === 'running') {
    return res.json({ status: 'already_running', message: 'スクレイプ実行中です' });
  }
  runScrape();
  res.json({ status: 'started', message: 'スクレイプ開始しました' });
});

/** 現在のステータス */
app.get('/api/status', (req, res) => {
  const config = loadConfig();
  res.json({
    scrapeStatus,
    lastScrapeTime,
    lastScrapeError,
    schedule: config.schedule,
    closingTime: config.closingTime
  });
});

/** 設定ファイルの取得 */
app.get('/api/config', (req, res) => {
  res.json(loadConfig());
});

/** 設定ファイルの更新 */
app.post('/api/config', (req, res) => {
  try {
    const newConfig = req.body;
    fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(newConfig, null, 2), 'utf-8');
    setupCronJob(); // スケジュール再設定
    setupRealtimeCronJob(); // リアルタイムスケジュール再設定
    res.json({ status: 'ok', message: '設定を更新しました' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================
// スクレイプ実行 (みんレポ過去データ)
// ============================

async function runScrape() {
  scrapeStatus = 'running';
  lastScrapeError = null;
  console.log(`[Server] スクレイプ開始: ${new Date().toLocaleString('ja-JP')}`);

  try {
    const data = await scrapeRecent(2);
    lastScrapeTime = new Date().toISOString();

    // 未知機種の自動検索
    const allNames = [];
    for (const day of Object.values(data)) {
      for (const m of day.machines) {
        allNames.push(m.機種名);
      }
    }
    await updateDBForNewMachines(allNames);

    scrapeStatus = 'idle';
    console.log(`[Server] スクレイプ完了: ${new Date().toLocaleString('ja-JP')}`);
  } catch (e) {
    scrapeStatus = 'error';
    lastScrapeError = e.message;
    console.error(`[Server] スクレイプエラー: ${e.message}`);
  }
}

// ============================
// リアルタイムスクレイプ実行 (d-deltanet)
// ============================

async function runRealtimeScrape() {
    if (realtimeFetchStatus === 'running') return;
    realtimeFetchStatus = 'running';
    console.log(`[Server] リアルタイムデータ取得開始: ${new Date().toLocaleString('ja-JP')}`);

    try {
        const data = await scrapeDDelta((current, total, modelName) => {
            realtimeProgress = { current, total, modelName };
        });
        realtimeProgress = { current: 0, total: 0, modelName: '' };
        if (data && data.length > 0) {
            cachedRealtimeData = data;
        } else {
            console.log('[Server] スクレイパーから0台返却。キャッシュは上書きしません。');
        }
        lastRealtimeFetch = new Date().toISOString();
        realtimeFetchStatus = 'idle';
        console.log(`[Server] リアルタイムデータ取得完了 (${cachedRealtimeData.length}台): ${new Date().toLocaleString('ja-JP')}`);

        // MongoDBにキャッシュ保存（0台でない場合のみ）
        if (cachedRealtimeData.length > 0) {
          try {
              await RealtimeCache.findOneAndUpdate(
                  { key: 'latest' },
                  { machines: cachedRealtimeData, timestamp: lastRealtimeFetch },
                  { upsert: true }
              );
              console.log('[Server] リアルタイムデータMongoDB保存完了');
          } catch (dbErr) {
              console.error('[Server] リアルタイムデータMongoDB保存失敗:', dbErr.message);
          }
        }
    } catch (e) {
        realtimeFetchStatus = 'error';
        console.error(`[Server] リアルタイムデータ取得エラー: ${e.message}`);
        setTimeout(() => { realtimeFetchStatus = 'idle'; }, 60000);
    }
}

// ============================
// 定期実行スケジュール
// ============================

let cronJob = null;
let cronJobRealtime = null;

function setupCronJob() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }

  const config = loadConfig();
  const sched = config.schedule;

  if (!sched.enabled) {
    console.log('[Server] 定期スクレイプ: 無効');
    return;
  }

  const interval = sched.intervalMinutes;
  const startH = sched.startHour;
  const endH = sched.endHour;

  const minutes = [];
  for (let m = sched.startMinute; m < 60; m += interval) {
    minutes.push(m);
  }
  const minuteExpr = minutes.join(',');
  const hourExpr = `${startH}-${endH}`;

  const cronExpr = `${minuteExpr} ${hourExpr} * * *`;
  console.log(`[Server] 定期スクレイプ設定: ${cronExpr} (${startH}:${String(sched.startMinute).padStart(2, '0')}〜${endH}:${String(sched.endMinute).padStart(2, '0')}, ${interval}分間隔)`);

  cronJob = cron.schedule(cronExpr, () => {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const endMinutes = endH * 60 + sched.endMinute;

    if (currentMinutes <= endMinutes) {
      console.log(`[Cron] 定期スクレイプ発動: ${now.toLocaleString('ja-JP')}`);
      runScrape();
    }
  });
}

function setupRealtimeCronJob() {
  // リアルタイムデータ取得はGitHub Actionsが担当
  if (cronJobRealtime) { cronJobRealtime.stop(); cronJobRealtime = null; }
  console.log('[Server] リアルタイム定期取得: GitHub Actions管轄のためスキップ');
}

// ============================
// 起動
// ============================

const os = require('os');
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

// DB接続してからサーバー起動
(async () => {
  try {
    await connectDB();

    // 起動時にMongoDBからリアルタイムキャッシュを復元
    try {
      const cached = await RealtimeCache.findOne({ key: 'latest' });
      if (cached && cached.machines && cached.machines.length > 0) {
        cachedRealtimeData = cached.machines;
        lastRealtimeFetch = cached.timestamp ? cached.timestamp.toISOString() : new Date().toISOString();
        console.log(`[Server] MongoDBからリアルタイムキャッシュ復元: ${cachedRealtimeData.length}台`);
      }
    } catch (cacheErr) {
      console.log('[Server] リアルタイムキャッシュ復元失敗:', cacheErr.message);
    }
  } catch (e) {
    console.error('[DB] 起動時のMongoDB接続失敗:', e.message);
  }

  app.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log(`\n🎰 楽園立川スロット設定判別ツール`);
    console.log(`   📱 スマホ → http://${ip}:${PORT}`);
    console.log(`   💻 PC    → http://localhost:${PORT}`);
    console.log(`   ─────────────────────────────`);
    const config = loadConfig();
    if (config.schedule.enabled) {
      console.log(`   📅 自動取得[過去]: ${config.schedule.startHour}:${String(config.schedule.startMinute).padStart(2, '0')}〜${config.schedule.endHour}:${String(config.schedule.endMinute).padStart(2, '0')} / ${config.schedule.intervalMinutes}分間隔`);
    }
    const rtSched = config.realtimeSchedule || {};
    if (rtSched.enabled) {
      console.log(`   🔥 自動取得[本日]: ${rtSched.startHour}:${String(rtSched.startMinute).padStart(2, '0')}〜${rtSched.endHour}:${String(rtSched.endMinute).padStart(2, '0')} / ${rtSched.intervalMinutes}分間隔`);
    }
    
    console.log(`   🚪 閉店: ${config.closingTime.hour}:${String(config.closingTime.minute).padStart(2, '0')}`);
    console.log(`   ⏱️  1G=${config.analysis.secondsPerGame}秒 / 最低G数=${config.analysis.minGames}G\n`);
    if (SCRAPING_DISABLED) {
      console.log('[Config] Cronジョブ無効 (DISABLE_SCRAPING=true) - 表示専用モード');
    } else {
      setupCronJob();
      setupRealtimeCronJob();
      // リアルタイムデータはGitHub ActionsがMongoDBに書き込むので、起動時のスクレープは不要
    }
  });
})();

