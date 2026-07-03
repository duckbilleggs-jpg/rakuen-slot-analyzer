/**
 * scrape_history_cli.js — ローカルPCでみんレポをスクレイプし、サーバーAPIへアップロード
 *
 * みんレポはクラウド(Render等)のIPをブロックするため、過去データは
 * このスクリプトを家庭用回線のPCで実行して取得する。
 *
 * Usage: node scrape_history_cli.js [日数] [サーバーURL]
 *   node scrape_history_cli.js 20
 *   node scrape_history_cli.js 7 https://rakuen-slot-analyzer.onrender.com
 */
const https = require('https');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
const DAYS = parseInt(process.argv[2]) || 7;
const SERVER = (process.argv[3] || 'https://rakuen-slot-analyzer.onrender.com').replace(/\/$/, '');

function fetchHTML(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchHTML(res.headers.location).then(resolve, reject);
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeDateKey(text) {
  const m = text.match(/(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const now = new Date();
  let year = m[1] ? parseInt(m[1]) : now.getFullYear();
  const month = parseInt(m[2]);
  // 年跨ぎ対応: 現在より2ヶ月以上先の月は前年扱い
  if (!m[1] && month > now.getMonth() + 2) year -= 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(parseInt(m[3])).padStart(2, '0')}`;
}

async function fetchDateList(maxDays, storeConfig) {
  const tagUrl = `${config.scrape.baseUrl}/tag/${encodeURIComponent(storeConfig.minrepoTag)}/`;
  const html = await fetchHTML(tagUrl);
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    const m = href.match(/min-repo\.com\/(\d+)\/?$/);
    if (!m || seen.has(m[1])) return;
    const dateMatch = text.match(/(\d{1,2})\/(\d{1,2})\((月|火|水|木|金|土|日)\)/);
    if (!dateMatch) return;
    const isStoreMatch = text.includes(storeConfig.minrepoTag) || text.includes(storeConfig.minrepoTag.replace('店', ''));
    const isDateOnlyMatch = text.trim() === dateMatch[0];
    if (isStoreMatch || isDateOnlyMatch) {
      seen.add(m[1]);
      results.push({ date: text, id: m[1], url: `${config.scrape.baseUrl}/${m[1]}/` });
    }
  });
  return results.slice(0, maxDays);
}

async function fetchDayData(url) {
  const allUrl = url.replace(/\/?$/, '/?kishu=all');
  const html = await fetchHTML(allUrl);
  const $ = cheerio.load(html);
  const rows = [];
  $('div.table_wrap table tr').each((i, tr) => {
    if (i === 0) return;
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

async function upload(storeId, days) {
  const res = await fetch(`${SERVER}/api/upload-history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storeId, days })
  });
  return res.json();
}

(async () => {
  console.log(`[HistCLI] 過去${DAYS}日分を全店舗からスクレイプ → ${SERVER} へアップロード`);
  for (const store of config.stores) {
    console.log(`\n=== ${store.name} (${store.id}) ===`);
    let dates;
    try {
      dates = await fetchDateList(DAYS, store);
    } catch (e) {
      console.log(`  ⚠ 日付リスト取得失敗: ${e.message}`);
      continue;
    }
    console.log(`  ${dates.length}件の日付を検出`);
    const days = [];
    for (const d of dates) {
      try {
        const machines = await fetchDayData(d.url);
        const dateKey = normalizeDateKey(d.date);
        if (dateKey && machines.length > 0) {
          days.push({ dateKey, reportId: d.id, dateRaw: d.date, machines });
          console.log(`  ${dateKey}: ${machines.length}台`);
        }
      } catch (e) {
        console.log(`  ⚠ ${d.date} 取得失敗: ${e.message}`);
      }
      await sleep(800);
    }
    if (days.length === 0) { console.log('  アップロード対象なし'); continue; }
    try {
      const result = await upload(store.id, days);
      console.log(`  ✅ アップロード完了:`, JSON.stringify(result));
    } catch (e) {
      console.log(`  ❌ アップロード失敗: ${e.message}`);
    }
  }
  console.log('\n[HistCLI] 完了');
})().catch(e => { console.error('[HistCLI] 致命的エラー:', e); process.exit(1); });
