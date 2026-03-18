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

/** 46円スロット台番号ホワイトリストを読み込み（5円スロット除外用） */
function loadSlot46Filter() {
  try {
    const nums = JSON.parse(fs.readFileSync(path.join(__dirname, 'slot46_numbers.json'), 'utf8'));
    return new Set(nums);
  } catch (e) {
    return null; // ファイルなし → フィルタなし
  }
}

/** 台データから5円スロットを除外 */
function filter46Only(machines) {
  const s46 = loadSlot46Filter();
  if (!s46) return machines; // ファイルなしなら全件返す
  return machines.filter(m => s46.has(m.台番) || s46.has(parseInt(m.台番)));
}

// 静的ファイル配信
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

/** 最新スクレイプ時刻の記録 */
let lastScrapeTime = null;
let scrapeStatus = 'idle'; // 'idle' | 'running' | 'error'
let lastScrapeError = null;

/** リアルタイムデータのキャッシュとステータス（店舗別） */
let cachedRealtimeData = {};   // { storeId: [...machines] }
let lastRealtimeFetch = {};     // { storeId: 'ISO timestamp' }
let realtimeFetchStatus = 'idle'; // 'idle' | 'running' | 'error'
let realtimeProgress = { current: 0, total: 0, modelName: '', storeName: '' };



// ============================
// API エンドポイント
// ============================

/** 最新の利用可能データを取得（今日→前日→前々日とフォールバック） */
async function getLatestData(storeId) {
  for (let i = 0; i < 3; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const data = await loadDayData(key, storeId);
    if (data && data.machines && data.machines.length > 0) {
      return { data, dateKey: key };
    }
  }
  return { data: null, dateKey: null };
}

/** データが古いかチェック（6時間以上前 or 無い場合） */
async function isDataStale(storeId) {
  const { data, dateKey } = await getLatestData(storeId);
  // データ自体が無い場合は古いと判定
  if (!data) return true;
  if (!lastScrapeTime) return false;
  const elapsed = Date.now() - new Date(lastScrapeTime).getTime();
  return elapsed > 6 * 60 * 60 * 1000; // 6時間以上経過したら古い
}

app.get('/api/stores', (req, res) => {
  const config = loadConfig();
  res.json(config.stores || []);
});

app.get('/health', async (req, res) => {
  if (!SCRAPING_DISABLED && await isDataStale() && scrapeStatus !== 'running') {
    console.log('[Auto] データが古いため自動スクレイプを開始(Health Check)');
    runScrape();
  }
  res.json({ status: 'ok', lastScrape: lastScrapeTime, scrapeStatus, scrapingDisabled: SCRAPING_DISABLED });
});

/** 設定5以上の高設定台一覧 (dateパラメータで過去日付指定可能) */
app.get('/api/high-setting', async (req, res) => {
  try {
    let data, dateKey;
    const requestedDate = req.query.date; // YYYY-MM-DD
    const storeId = req.query.store || 'tachikawa';

    if (requestedDate) {
      // 指定日のデータを取得
      data = await loadDayData(requestedDate, storeId);
      dateKey = requestedDate;
    } else {
      // デフォルト: 最新データ
      if (!SCRAPING_DISABLED && await isDataStale(storeId) && scrapeStatus !== 'running') {
        console.log('[Auto] データが古いため自動スクレイプを開始(API Request)');
        runScrape();
      }
      const latest = await getLatestData(storeId);
      data = latest.data;
      dateKey = latest.dateKey;
    }

    if (!data || !data.machines) {
      return res.json({ machines: [], lastScrape: lastScrapeTime, scrapeStatus, dateKey, message: 'データがありません。' });
    }
    const config = loadConfig();
    const now = lastScrapeTime ? new Date(lastScrapeTime) : new Date();
    const filtered = filter46Only(data.machines);
    const highSetting = analyzeHighSetting(filtered, now, data.id);
    res.json({
      machines: highSetting,
      lastScrape: lastScrapeTime,
      closingTime: `${config.closingTime.hour}:${String(config.closingTime.minute).padStart(2, '0')}`,
      totalMachines: data.machines.length,
      date: data.date,
      dateKey: dateKey,
      reportId: data.id
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** 全台データ */
app.get('/api/all', async (req, res) => {
  try {
    const storeId = req.query.store || 'tachikawa';
    const { data } = await getLatestData(storeId);
    if (!data || !data.machines) {
      return res.json({ machines: [], lastScrape: lastScrapeTime, message: 'データがありません' });
    }
    res.json({
      machines: filter46Only(data.machines),
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
        const storeId = req.query.store || 'tachikawa';
        const storeData = cachedRealtimeData[storeId] || [];
        const storeTimestamp = lastRealtimeFetch[storeId] || null;

        res.json({
            machines: storeData,
            timestamp: storeTimestamp,
            status: realtimeFetchStatus,
            progress: realtimeProgress,
            message: realtimeFetchStatus === 'running' 
                ? `スクレイピング中... ${realtimeProgress.current}/${realtimeProgress.total} ${realtimeProgress.modelName} (${realtimeProgress.storeName})`
                : storeData.length > 0 
                    ? `リアルタイムデータ（${storeData.length}台）` 
                    : 'データ未取得'
        });
    } catch (e) {
        console.error('[API] /api/realtime エラー:', e);
        res.status(500).json({ error: e.message });
    }
});

/** リアルタイム手動取得トリガー（スクレイピングはスケジュール実行のみ） */
app.post('/api/realtime', async (req, res) => {
    res.json({ status: 'info', message: 'リアルタイムデータは設定画面のスケジュールに従って自動取得されます' });
});

/** 激熱予測（機種別設定⑤⑥判別ベース） */
app.get('/api/forecast', async (req, res) => {
    try {
        console.log('[API] /api/forecast リクエスト受信');
        const { Machine } = require('./database');
        const { loadDB, getDefaultSpecs } = require('./machine_lookup');
        
        // 46円スロット台番号ホワイトリスト読み込み（なければフィルタなし）
        let slot46Numbers = null;
        try {
            slot46Numbers = JSON.parse(fs.readFileSync(path.join(__dirname, 'slot46_numbers.json'), 'utf8'));
        } catch (e) { /* ファイルなし → フィルタなし */ }
        
        // 期間パラメータ対応（デフォルト: 過去30日）
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        let dateLimit, dateEnd;
        
        if (startDate) {
            dateLimit = startDate;
        } else {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            dateLimit = thirtyDaysAgo.toISOString().split('T')[0];
        }
        
        if (endDate) {
            dateEnd = endDate;
        } else {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            dateEnd = yesterday.toISOString().split('T')[0];
        }

        const storeId = req.query.store || 'tachikawa';

        let records = await Machine.find({
            storeId: storeId,
            dateKey: { $gte: dateLimit, $lte: dateEnd },
            G数: { $gte: 3000 }
        }).lean();
        
        // 46円スロットのみに絞り込み（台番号ホワイトリストがある場合）
        if (slot46Numbers && slot46Numbers.length > 0) {
            const numSet = new Set(slot46Numbers);
            records = records.filter(r => numSet.has(r.台番));
        }

        // 機種別理論出率DBを使って各レコードの設定を判定
        const db = loadDB();
        const machineStats = {}; // { "機種名_台番": { s6回数, s5回数, ... } }
        
        for (const r of records) {
            const specs = db[r.機種名] || getDefaultSpecs();
            const key = `${r.機種名}_${r.台番}`;
            
            if (!machineStats[key]) {
                machineStats[key] = {
                    機種名: r.機種名, 台番: r.台番,
                    s6回数: 0, s5回数: 0, 総日数: 0,
                    出率合計: 0, 差枚合計: 0, 直近確認日: ''
                };
            }
            const stat = machineStats[key];
            stat.総日数++;
            stat.出率合計 += (r.出率 || 0);
            stat.差枚合計 += (r.差枚 || 0);
            if (r.dateKey > stat.直近確認日) stat.直近確認日 = r.dateKey;
            
            // 機種ごとの理論出率で設定判定
            if (specs.s6 && r.出率 >= specs.s6) {
                stat.s6回数++;
            } else if (specs.s5 && r.出率 >= specs.s5) {
                stat.s5回数++;
            }
        }

        // 結果整形＆ソート
        const formatted = Object.values(machineStats)
            .filter(s => (s.s6回数 + s.s5回数) >= 1) // ⑤⑥が1回以上
            .map(s => ({
                機種名: s.機種名,
                台番: s.台番,
                設定6回数: s.s6回数,
                設定5回数: s.s5回数,
                高設定合計: s.s6回数 + s.s5回数,
                総日数: s.総日数,
                平均出率: parseFloat((s.出率合計 / s.総日数).toFixed(1)),
                直近確認日: s.直近確認日,
                おすすめ度: s.s6回数 >= 3 ? '★★★ 激熱'
                    : (s.s6回数 + s.s5回数) >= 3 ? '★★☆ チャンス'
                    : '★☆☆ 狙い目'
            }))
            // 設定⑥回数 降順 → ⑤⑥合計 降順 → 平均出率 降順
            .sort((a, b) => b.設定6回数 - a.設定6回数 || b.高設定合計 - a.高設定合計 || b.平均出率 - a.平均出率)
            .slice(0, 50);

        res.json({
            machines: formatted,
            targetPeriod: `${dateLimit} 〜 ${dateEnd}`,
            startDate: dateLimit,
            endDate: dateEnd,
            criteria: '機種別理論出率に基づく設定⑤⑥判定',
            is46Only: !!slot46Numbers,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        console.error('[API] /api/forecast エラー:', e);
        res.status(500).json({ error: e.message });
    }
});

/** 台番詳細: 指定期間内の日別設定⑤⑥判定履歴 */
app.get('/api/machine-history', async (req, res) => {
    try {
        const { Machine } = require('./database');
        const { loadDB, getDefaultSpecs } = require('./machine_lookup');
        const { machineNo, startDate, endDate } = req.query;
        if (!machineNo) return res.status(400).json({ error: '台番を指定してください' });

        let dateLimit = startDate;
        let dateEnd = endDate;
        if (!dateLimit) {
            const d = new Date(); d.setDate(d.getDate() - 30);
            dateLimit = d.toISOString().split('T')[0];
        }
        if (!dateEnd) {
            const d = new Date(); d.setDate(d.getDate() - 1);
            dateEnd = d.toISOString().split('T')[0];
        }

        const storeId = req.query.store || 'tachikawa';

        const records = await Machine.find({
            storeId: storeId,
            台番: machineNo,
            dateKey: { $gte: dateLimit, $lte: dateEnd }
        }).sort({ dateKey: -1 }).lean();

        const db = loadDB();
        const history = records.map(r => {
            const specs = db[r.機種名] || getDefaultSpecs();
            let setting = '-';
            if (specs.s6 && r.出率 >= specs.s6) setting = '⑥';
            else if (specs.s5 && r.出率 >= specs.s5) setting = '⑤';
            return {
                日付: r.dateKey,
                機種名: r.機種名,
                出率: r.出率,
                差枚: r.差枚,
                G数: r.G数,
                推定設定: setting
            };
        });

        res.json({
            machineNo,
            startDate: dateLimit,
            endDate: dateEnd,
            history,
            s6count: history.filter(h => h.推定設定 === '⑥').length,
            s5count: history.filter(h => h.推定設定 === '⑤').length,
        });
    } catch (e) {
        console.error('[API] /api/machine-history エラー:', e);
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
    const config = loadConfig();
    const allNames = [];

    for (const store of config.stores) {
      console.log(`[Server] みんレポ取得: ${store.name}...`);
      try {
        const data = await scrapeRecent(2, store);
        for (const day of Object.values(data)) {
          for (const m of day.machines) {
            allNames.push(m.機種名);
          }
        }
      } catch (storeErr) {
        console.error(`[Server] ${store.name} スクレイプエラー: ${storeErr.message}`);
      }
    }

    lastScrapeTime = new Date().toISOString();

    // 未知機種の自動検索
    if (allNames.length > 0) {
      await updateDBForNewMachines(allNames);
    }

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
        const cfg = loadConfig();
        for (const store of cfg.stores) {
            console.log(`[Server] リアルタイム取得: ${store.name}...`);
            realtimeProgress = { current: 0, total: 0, modelName: '', storeName: store.name };

            try {
                const data = await scrapeDDelta((current, total, modelName) => {
                    realtimeProgress = { current, total, modelName, storeName: store.name };
                }, store);

                if (data && data.length > 0) {
                    cachedRealtimeData[store.id] = data;
                    lastRealtimeFetch[store.id] = new Date().toISOString();
                    console.log(`[Server] ${store.name} リアルタイム取得完了 (${data.length}台)`);

                    // MongoDBにキャッシュ保存
                    try {
                        await RealtimeCache.findOneAndUpdate(
                            { key: `latest_${store.id}` },
                            { machines: data, timestamp: lastRealtimeFetch[store.id] },
                            { upsert: true }
                        );
                        console.log(`[Server] ${store.name} リアルタイムデータMongoDB保存完了`);
                    } catch (dbErr) {
                        console.error(`[Server] ${store.name} MongoDB保存失敗:`, dbErr.message);
                    }
                } else {
                    console.log(`[Server] ${store.name} スクレイパーから0台返却。キャッシュは上書きしません。`);
                }
            } catch (storeErr) {
                console.error(`[Server] ${store.name} リアルタイム取得エラー: ${storeErr.message}`);
            }
        }

        realtimeProgress = { current: 0, total: 0, modelName: '', storeName: '' };
        realtimeFetchStatus = 'idle';
        console.log(`[Server] 全店舗リアルタイムデータ取得完了: ${new Date().toLocaleString('ja-JP')}`);
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
  if (cronJobRealtime) { cronJobRealtime.stop(); cronJobRealtime = null; }

  const config = loadConfig();
  const rt = config.realtimeSchedule;

  if (!rt || !rt.enabled) {
    console.log('[Server] リアルタイム定期取得: 無効');
    return;
  }

  const interval = rt.intervalMinutes || 30;
  const startH = rt.startHour;
  const endH = rt.endHour;

  const minutes = [];
  for (let m = (rt.startMinute || 0); m < 60; m += interval) {
    minutes.push(m);
  }
  const minuteExpr = minutes.join(',');
  const hourExpr = `${startH}-${endH}`;
  const cronExpr = `${minuteExpr} ${hourExpr} * * *`;

  console.log(`[Server] リアルタイム定期取得設定: ${cronExpr} (${startH}:${String(rt.startMinute || 0).padStart(2, '0')}〜${endH}:${String(rt.endMinute || 0).padStart(2, '0')}, ${interval}分間隔)`);

  cronJobRealtime = cron.schedule(cronExpr, () => {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const endMinutes = endH * 60 + (rt.endMinute || 0);

    if (currentMinutes <= endMinutes) {
      console.log(`[Cron] リアルタイムスクレイプ発動: ${now.toLocaleString('ja-JP')}`);
      runRealtimeScrape();
    }
  });
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

    // 起動時にMongoDBからリアルタイムキャッシュを復元（全店舗）
    try {
      const cfg = loadConfig();
      for (const store of cfg.stores) {
        const cached = await RealtimeCache.findOne({ key: `latest_${store.id}` });
        if (cached && cached.machines && cached.machines.length > 0) {
          cachedRealtimeData[store.id] = cached.machines;
          lastRealtimeFetch[store.id] = cached.timestamp ? cached.timestamp.toISOString() : new Date().toISOString();
          console.log(`[Server] MongoDBからリアルタイムキャッシュ復元 (${store.name}): ${cached.machines.length}台`);
        }
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

