/**
 * scraper.js — みんレポからスロットデータを取得
 */
const https = require('https');
const http = require('http');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));

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
 * @returns {Array<{date:string, url:string}>}
 */
async function fetchDateList(maxDays = 7) {
  const tagUrl = `${config.scrape.baseUrl}/tag/${encodeURIComponent(config.scrape.storeTag)}/`;
  const html = await fetch(tagUrl);
  const $ = cheerio.load(html);
  const results = [];

  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    // match links like /2974720/ with date text like 3/12(木)
    const m = href.match(/min-repo\.com\/(\d+)\/?$/);
    if (m && /\d+\/\d+/.test(text)) {
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
 */
async function scrapeRecent(days = 1) {
  console.log(`[Scraper] ${days}日分のデータを取得開始...`);
  const dates = await fetchDateList(days);
  console.log(`[Scraper] ${dates.length}件の日付を検出`);

  const allData = {};
  for (const d of dates) {
    console.log(`[Scraper] ${d.date} (${d.url}) を取得中...`);
    const rows = await fetchDayData(d.url);
    console.log(`[Scraper]   → ${rows.length}台のデータ取得`);

    // 日付文字列を正規化 (3/12(木) → 2026-03-12 etc.)
    const dateKey = normalizeDateKey(d.date);
    allData[dateKey] = { date: d.date, id: d.id, machines: rows };

    // 日別ファイル保存
    const filePath = path.join(DATA_DIR, `${dateKey}.json`);
    fs.writeFileSync(filePath, JSON.stringify({ date: d.date, id: d.id, machines: rows }, null, 2), 'utf-8');

    await sleep(config.scrape.requestIntervalMs);
  }

  return allData;
}

/**
 * 今日のデータだけスクレイプ
 */
async function scrapeToday() {
  return scrapeRecent(1);
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

/** 保存済みデータを読み込み */
function loadDayData(dateKey) {
  const filePath = path.join(DATA_DIR, `${dateKey}.json`);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  return null;
}

/** 今日の日付キーを返す */
function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// CLI 実行
if (require.main === module) {
  const args = process.argv.slice(2);
  const days = args.includes('--test') ? 1 : parseInt(args[0]) || 1;
  scrapeRecent(days).then(data => {
    const total = Object.values(data).reduce((s, d) => s + d.machines.length, 0);
    console.log(`[Scraper] 完了: 合計 ${total} 台のデータを取得`);
  }).catch(err => {
    console.error('[Scraper] エラー:', err.message);
    process.exit(1);
  });
}

module.exports = { scrapeRecent, scrapeToday, fetchDateList, fetchDayData, loadDayData, todayKey, normalizeDateKey };
