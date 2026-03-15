/**
 * server.js — Express APIサーバー + 定期スクレイプ
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { connectDB } = require('./database');
const { scrapeToday, scrapeRecent, loadDayData, todayKey, normalizeDateKey } = require('./scraper');
const { analyzeHighSetting, analyzeAll } = require('./analyzer');
const { updateDBForNewMachines } = require('./machine_lookup');

const app = express();
const PORT = process.env.PORT || 3000;

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
  // lastScrapeTime が記録されていない（サーバー起動直後）でも
  // MongoDBにデータがあればスクレイプ不要と判定する
  if (!lastScrapeTime) return false;
  const elapsed = Date.now() - new Date(lastScrapeTime).getTime();
  return elapsed > 6 * 60 * 60 * 1000; // 6時間以上経過したら古い
}

app.get('/health', async (req, res) => {
  if (await isDataStale() && scrapeStatus !== 'running') {
    console.log('[Auto] データが古いため自動スクレイプを開始(Health Check)');
    runScrape();
  }
  res.json({ status: 'ok', lastScrape: lastScrapeTime, scrapeStatus });
});

/** 設定5以上の高設定台一覧 */
app.get('/api/high-setting', async (req, res) => {
  try {
    if (await isDataStale() && scrapeStatus !== 'running') {
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
    res.json({ status: 'ok', message: '設定を更新しました' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================
// スクレイプ実行
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
// 定期実行スケジュール
// ============================

let cronJob = null;

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

  // intervalMinutes間隔で startHour:startMinute 〜 endHour:endMinute の間実行
  // cron式: */30 18-23 * * * のような形式
  const interval = sched.intervalMinutes;
  const startH = sched.startHour;
  const endH = sched.endHour;

  // 分の指定: startMinuteからinterval間隔
  const minutes = [];
  for (let m = sched.startMinute; m < 60; m += interval) {
    minutes.push(m);
  }
  const minuteExpr = minutes.join(',');

  // 時間範囲
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

app.listen(PORT, '0.0.0.0', async () => {
  await connectDB();
  
  const ip = getLocalIP();
  console.log(`\n🎰 楽園立川スロット設定判別ツール`);
  console.log(`   📱 スマホ → http://${ip}:${PORT}`);
  console.log(`   💻 PC    → http://localhost:${PORT}`);
  console.log(`   ─────────────────────────────`);
  const config = loadConfig();
  if (config.schedule.enabled) {
    console.log(`   📅 自動取得: ${config.schedule.startHour}:${String(config.schedule.startMinute).padStart(2, '0')}〜${config.schedule.endHour}:${String(config.schedule.endMinute).padStart(2, '0')} / ${config.schedule.intervalMinutes}分間隔`);
  }
  console.log(`   🚪 閉店: ${config.closingTime.hour}:${String(config.closingTime.minute).padStart(2, '0')}`);
  console.log(`   ⏱️  1G=${config.analysis.secondsPerGame}秒 / 最低G数=${config.analysis.minGames}G\n`);
  setupCronJob();
});

