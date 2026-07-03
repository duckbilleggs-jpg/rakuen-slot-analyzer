/**
 * scrape_history_cli.js — ローカルPCでみんレポをスクレイプし、サーバーAPIへアップロード
 *
 * みんレポは 2026-06 頃からボット対策が強化され、
 *  - クラウド(Render等)IPからのアクセスは古いキャッシュ/空ページ
 *  - 通常のHTTP GETでは ?kishu=all (全台データ) が空レスポンス
 * となったため、Puppeteer(実Chrome)で「ページ内リンクをクリックして遷移」する方式で取得する。
 *
 * Usage: node scrape_history_cli.js [日数] [サーバーURL]
 *   node scrape_history_cli.js 20
 *   node scrape_history_cli.js 7 https://rakuen-slot-analyzer.onrender.com
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
const DAYS = parseInt(process.argv[2]) || 7;
const SERVER = (process.argv[3] || 'https://rakuen-slot-analyzer.onrender.com').replace(/\/$/, '');
const ONLY_STORE = process.argv[4] || null; // 特定店舗のみ実行 (storeId)

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeDateKey(text) {
  const m = text.match(/(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const now = new Date();
  let year = m[1] ? parseInt(m[1]) : now.getFullYear();
  const month = parseInt(m[2]);
  if (!m[1] && month > now.getMonth() + 2) year -= 1; // 年跨ぎ対応
  return `${year}-${String(month).padStart(2, '0')}-${String(parseInt(m[3])).padStart(2, '0')}`;
}

/** 店舗タグページから日付別レポートURLを取得 */
async function fetchDateList(page, maxDays, storeConfig) {
  const tagUrl = `${config.scrape.baseUrl}/tag/${encodeURIComponent(storeConfig.minrepoTag)}/`;
  await page.goto(tagUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  return page.evaluate((tag, tagNoMise, max) => {
    const results = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a')) {
      const href = a.getAttribute('href') || '';
      const text = a.textContent.trim();
      const m = href.match(/min-repo\.com\/(\d+)\/?$/) || href.match(/^\/(\d+)\/?$/);
      if (!m || seen.has(m[1])) continue;
      const dateMatch = text.match(/(\d{1,2})\/(\d{1,2})\((月|火|水|木|金|土|日)\)/);
      if (!dateMatch) continue;
      const isStoreMatch = text.includes(tag) || text.includes(tagNoMise);
      const isDateOnly = text === dateMatch[0];
      if (isStoreMatch || isDateOnly) {
        seen.add(m[1]);
        results.push({ date: text, id: m[1] });
      }
      if (results.length >= max) break;
    }
    return results;
  }, storeConfig.minrepoTag, storeConfig.minrepoTag.replace('店', ''), maxDays);
}

/** レポートページを開き「全台データ」リンクをクリックして per-台 テーブルを取得 */
async function fetchDayData(page, reportId) {
  const url = `${config.scrape.baseUrl}/${reportId}/`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const hasLink = await page.evaluate(() => {
    return !!([...document.querySelectorAll('a')].find(a => (a.getAttribute('href') || '').includes('kishu=all')));
  });
  if (!hasLink) return [];
  const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
  await page.evaluate(() => {
    const a = [...document.querySelectorAll('a')].find(a => (a.getAttribute('href') || '').includes('kishu=all'));
    a.click();
  });
  await nav;
  await sleep(1200);

  return page.evaluate(() => {
    let big = null;
    for (const t of document.querySelectorAll('table')) {
      const n = t.querySelectorAll('tr').length;
      if (n > 15) { big = t; break; }
    }
    if (!big) return [];
    const rows = [...big.querySelectorAll('tr')];
    const header = [...rows[0].querySelectorAll('td,th')].map(c => c.textContent.trim());
    const idx = {
      機種: header.findIndex(h => h.includes('機種')),
      台番: header.findIndex(h => h.includes('台')),
      差枚: header.findIndex(h => h.includes('差枚')),
      G数: header.findIndex(h => h.includes('G')),
      出率: header.findIndex(h => h.includes('出率'))
    };
    if (idx.機種 < 0 || idx.台番 < 0) return [];
    const out = [];
    for (const tr of rows.slice(1)) {
      const cells = [...tr.querySelectorAll('td')].map(c => c.textContent.trim());
      if (cells.length < 5) continue;
      out.push({
        機種名: cells[idx.機種],
        台番: parseInt(cells[idx.台番]) || cells[idx.台番],
        差枚: parseInt(cells[idx.差枚].replace(/,/g, '')) || 0,
        G数: parseInt(cells[idx.G数].replace(/,/g, '')) || 0,
        出率: parseFloat(cells[idx.出率].replace(/%/g, '')) || 0
      });
    }
    return out;
  });
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
  const chromePath = CHROME_PATHS.find(p => { try { return fs.existsSync(p); } catch { return false; } });
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: chromePath,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');

  try {
    for (const store of config.stores) {
      if (ONLY_STORE && store.id !== ONLY_STORE) continue;
      console.log(`\n=== ${store.name} (${store.id}) ===`);
      let dates;
      try {
        dates = await fetchDateList(page, DAYS, store);
      } catch (e) {
        console.log(`  ⚠ 日付リスト取得失敗: ${e.message}`);
        continue;
      }
      console.log(`  ${dates.length}件の日付を検出`);
      const days = [];
      for (const d of dates) {
        try {
          const machines = await fetchDayData(page, d.id);
          const dateKey = normalizeDateKey(d.date);
          if (dateKey && machines.length > 0) {
            days.push({ dateKey, reportId: d.id, dateRaw: d.date, machines });
            console.log(`  ${dateKey}: ${machines.length}台`);
          } else {
            console.log(`  ${d.date}: データなし`);
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
  } finally {
    await browser.close();
  }
  console.log('\n[HistCLI] 完了');
})().catch(e => { console.error('[HistCLI] 致命的エラー:', e); process.exit(1); });
