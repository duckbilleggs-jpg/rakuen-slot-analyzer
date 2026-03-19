/**
 * scraper.js — みんレポからスロットデータを取得
 */
const https = require('https');
const http = require('http');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { Machine } = require('./database');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));

// DEBUG: DB接続先確認 (一時的)
const _uri = process.env.MONGODB_URI || '';
const _dbName = _uri.split('/').pop()?.split('?')[0] || 'UNKNOWN';
console.log(`[Debug] MongoDB DB名: ${_dbName}`);

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/** HTTP GET (follows redirects) */
function fetch(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve, reject);
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

/** delay helper */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 店舗タグページから日付別URLリストを取得
 * @param {number} maxDays
 * @param {Object} storeConfig - { id, name, minrepoTag }
 * @returns {Array<{date:string, url:string}>}
 */
async function fetchDateList(maxDays = 7, storeConfig) {
  const tagUrl = `${config.scrape.baseUrl}/tag/${encodeURIComponent(storeConfig.minrepoTag)}/`;
  const html = await fetch(tagUrl);
  const $ = cheerio.load(html);
  const results = [];

  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    // match links like /2974720/
    const m = href.match(/min-repo\.com\/(\d+)\/?$/);
    if (!m) return;

    const dateMatch = text.match(/(\d{1,2})\/(\d{1,2})\((月|火|水|木|金|土|日)\)/);
    if (!dateMatch) return;

    // 店舗名が含まれているか、または日付のみのリンクか（錦糸町などで日付のみのケースがあるため）
    const isStoreMatch = text.includes(storeConfig.minrepoTag) || text.includes(storeConfig.minrepoTag.replace('店', ''));
    const isDateOnlyMatch = text.trim() === dateMatch[0];

    if (isStoreMatch || isDateOnlyMatch) {
      results.push({ date: text, id: m[1], url: `${config.scrape.baseUrl}/${m[1]}/` });
    }
  });

  return results.slice(0, maxDays);
}

/**
 * 特定日の全台データをパース
 * @param {string} url  e.g. https://min-repo.com/2974720/
 * @returns {Array<{機種名,台番,差枚,G数,出率}>}
 */
async function fetchDayData(url) {
  const allUrl = url.replace(/\/?$/, '/?kishu=all');
  const html = await fetch(allUrl);
  const $ = cheerio.load(html);
  const rows = [];

  $('div.table_wrap table tr').each((i, tr) => {
    if (i === 0) return; // skip header
    const cells = $(tr).find('td');
    if (cells.length < 5) return;

    const 機種名 = $(cells[0]).text().trim();
    const 台番 = $(cells[1]).text().trim();
    const 差枚raw = $(cells[2]).text().trim().replace(/,/g, '');
    const G数raw = $(cells[3]).text().trim().replace(/,/g, '');
    const 出率raw = $(cells[4]).text().trim().replace(/%/g, '');

    rows.push({
      機種名,
      台番: parseInt(台番) || 台番,
      差枚: parseInt(差枚raw) || 0,
      G数: parseInt(G数raw) || 0,
      出率: parseFloat(出率raw) || 0
    });
  });

  return rows;
}

/**
 * 直近N日分のデータをスクレイプして保存
 * @param {number} days
 * @param {Object} storeConfig
 */
async function scrapeRecent(days = 1, storeConfig) {
  console.log(`[Scraper] ${storeConfig.name} (${storeConfig.minrepoTag}) ${days}日分のデータを取得開始...`);
  const dates = await fetchDateList(days, storeConfig);
  console.log(`[Scraper] ${dates.length}件の日付を検出`);

  const allData = {};
  for (const d of dates) {
    console.log(`[Scraper] ${d.date} (${d.url}) を取得中...`);
    const rows = await fetchDayData(d.url);
    console.log(`[Scraper]   → ${rows.length}台のデータ取得`);

    // 日付文字列を正規化 (3/12(木) → 2026-03-12 etc.)
    const dateKey = normalizeDateKey(d.date);
    allData[dateKey] = { date: d.date, id: d.id, machines: rows };

    // 日別ファイル保存 (バックアップ用途で一応残す)
    const filePath = path.join(DATA_DIR, `${storeConfig.id}_${dateKey}.json`);
    fs.writeFileSync(filePath, JSON.stringify({ date: d.date, id: d.id, machines: rows, storeId: storeConfig.id }, null, 2), 'utf-8');

    // MongoDB への一括 Upsert
    try {
      if (rows.length > 0) {
        const ops = rows.map(m => ({
          updateOne: {
            filter: { storeId: storeConfig.id, dateKey, 台番: m.台番 },
            update: {
              $set: {
                reportId: d.id,
                dateRaw: d.date,
                機種名: m.機種名,
                差枚: m.差枚,
                G数: m.G数,
                出率: m.出率
              }
            },
            upsert: true
          }
        }));
        const res = await Machine.bulkWrite(ops);
        console.log(`[Scraper]   → MongoDBへ ${rows.length}件 保存/更新完了 (${storeConfig.name}) [upserted:${res.upsertedCount}, modified:${res.modifiedCount}]`);
      }
    } catch (err) {
      console.error(`[Scraper] MongoDB書き込みエラー(${dateKey}):`, err.message);
    }

    await sleep(config.scrape.requestIntervalMs);
  }

  return allData;
}

/**
 * 今日のデータだけスクレイプ
 */
async function scrapeToday(storeConfig) {
  return scrapeRecent(1, storeConfig);
}

/** 日付文字テキストを YYYY-MM-DD に変換 */
function normalizeDateKey(text) {
  // "3/12(木)" or "2025/12/31(水)"
  const m = text.match(/(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})/);
  if (!m) return text;
  const now = new Date();
  const year = m[1] ? parseInt(m[1]) : now.getFullYear();
  const month = String(parseInt(m[2])).padStart(2, '0');
  const day = String(parseInt(m[3])).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 保存済みデータを読み込み (MongoDB優先、なければローカルファイル) */
async function loadDayData(dateKey, storeId = 'tachikawa') {
  try {
    const docs = await Machine.find({ dateKey, storeId }).lean();
    if (docs && docs.length > 0) {
      // 形式を { date, id, machines: [...] } に整えて返す
      const first = docs[0];
      return {
        date: first.dateRaw,
        id: first.reportId,
        machines: docs
      };
    }
  } catch (err) {
    console.error(`[Scraper] DB読み込みエラー(${dateKey}):`, err.message);
  }

  // DBになければフォールバックとしてローカルファイルを見る
  const fileWithStore = path.join(DATA_DIR, `${storeId}_${dateKey}.json`);
  const fileOld = path.join(DATA_DIR, `${dateKey}.json`);
  
  let filePath = fileWithStore;
  if (!fs.existsSync(fileWithStore)) {
    if (fs.existsSync(fileOld)) {
      filePath = fileOld;
    } else {
      return null;
    }
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);

  // 古い形式のファイルの場合、店舗IDが一致するかチェック（安全のため）
  if (data.storeId && data.storeId !== storeId) {
    return null;
  }

  return data;
}

/** 今日の日付キーを返す */
function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// CLI 実行
if (require.main === module) {
  const { connectDB } = require('./database');
  const args = process.argv.slice(2);
  let days = 1;
  let testMode = false;
  let storeId = 'tachikawa';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--test') testMode = true;
    else if (args[i] === '--store' && args[i+1]) storeId = args[++i];
    else if (!isNaN(parseInt(args[i]))) days = parseInt(args[i]);
  }
  
  const targetStore = config.stores.find(s => s.id === storeId);
  if (!targetStore) {
    console.error(`[Scraper] エラー: 指定された店舗ID '${storeId}' がconfig.jsonに見つかりません。`);
    process.exit(1);
  }

  connectDB().then(() => {
    return scrapeRecent(testMode ? 1 : days, targetStore);
  }).then(data => {
    const total = Object.values(data).reduce((s, d) => s + d.machines.length, 0);
    console.log(`[Scraper] 完了: 合計 ${total} 台のデータを取得 (${targetStore.name})`);
    process.exit(0);
  }).catch(err => {
    console.error('[Scraper] エラー:', err.message);
    process.exit(1);
  });
}

module.exports = { scrapeRecent, scrapeToday, fetchDateList, fetchDayData, loadDayData, todayKey, normalizeDateKey };
