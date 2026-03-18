/**
 * machine_lookup.js — 未知機種の設定別理論出率をWeb検索で自動取得
 */
const https = require('https');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'machine_db.json');

function loadDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

/** HTTP GET */
function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve, reject);
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 機種名でWeb検索して設定別出率を取得する
 * Google検索結果から cs-plaza.com, nana-press.com, hisshobon.jp のページを探す
 */
async function lookupMachineSpecs(machineName) {
  console.log(`[Lookup] "${machineName}" の設定別出率を検索中...`);

  // 方法1: cs-plaza.com で直接検索
  const specs = await tryCSPlaza(machineName);
  if (specs) return specs;

  // 方法2: hisshobon.jp で検索
  const specs2 = await tryHisshobon(machineName);
  if (specs2) return specs2;

  // 方法3: Google検索経由
  const specs3 = await tryGoogleSearch(machineName);
  if (specs3) return specs3;

  console.log(`[Lookup] "${machineName}" のスペック取得失敗 → デフォルト値を使用`);
  return getDefaultSpecs();
}

/** cs-plaza.com から検索 */
async function tryCSPlaza(name) {
  try {
    const searchUrl = `https://cs-plaza.com/?s=${encodeURIComponent(name + ' 機械割')}`;
    const html = await fetch(searchUrl);
    const $ = cheerio.load(html);

    // 検索結果の最初のリンクを取得
    let targetUrl = null;
    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text();
      if (href.includes('cs-plaza.com') && (text.includes('設定') || text.includes('機械割') || text.includes('スペック'))) {
        if (!targetUrl) targetUrl = href;
      }
    });

    if (!targetUrl) return null;
    await sleep(500);

    const pageHtml = await fetch(targetUrl);
    return parsePayoutTable(pageHtml);
  } catch (e) {
    console.log(`[Lookup] cs-plaza検索エラー: ${e.message}`);
    return null;
  }
}

/** hisshobon.jp から検索 */
async function tryHisshobon(name) {
  try {
    const searchUrl = `https://hisshobon.jp/?s=${encodeURIComponent(name)}`;
    const html = await fetch(searchUrl);
    const $ = cheerio.load(html);

    let targetUrl = null;
    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (href.includes('hisshobon.jp') && href.includes('slot') && !targetUrl) {
        targetUrl = href;
      }
    });

    if (!targetUrl) return null;
    await sleep(500);

    const pageHtml = await fetch(targetUrl);
    return parsePayoutTable(pageHtml);
  } catch (e) {
    console.log(`[Lookup] hisshobon検索エラー: ${e.message}`);
    return null;
  }
}

/** Google検索経由 */
async function tryGoogleSearch(name) {
  try {
    // Google検索結果ページのスクレイプは制限が厳しいため、
    // 別アプローチ: 有名なスロットDB系サイトを直接叩く
    const sites = [
      `https://www.nana-press.com/?s=${encodeURIComponent(name + ' 機械割')}`,
    ];

    for (const url of sites) {
      try {
        const html = await fetch(url);
        const specs = parsePayoutTable(html);
        if (specs) return specs;
      } catch (e) { /* skip */ }
      await sleep(500);
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * HTMLページから設定別出率テーブルをパース
 * 「設定1」「97.6%」のようなパターンを探す
 */
function parsePayoutTable(html) {
  const $ = cheerio.load(html);
  const specs = {};

  // テーブル内の設定×出率パターンを検索
  $('table').each((_, table) => {
    const rows = $(table).find('tr');
    rows.each((_, tr) => {
      const cells = $(tr).find('td, th');
      const texts = [];
      cells.each((_, c) => texts.push($(c).text().trim()));
      const row = texts.join(' ');

      // 「設定1  97.6%」のようなパターン
      for (let s = 1; s <= 6; s++) {
        const regex = new RegExp(`設定${s}[^\\d]*(\\d{2,3}\\.\\d)\\s*%?`);
        const m = row.match(regex);
        if (m) {
          specs[`s${s}`] = parseFloat(m[1]);
        }
      }
    });
  });

  // テーブル外のテキストからも探す
  const bodyText = $('body').text();
  for (let s = 1; s <= 6; s++) {
    if (!specs[`s${s}`]) {
      // "設定1：97.6%" or "設定1 97.6%"
      const regex = new RegExp(`設定${s}[：:\\s]+(\\d{2,3}\\.\\d)\\s*%`);
      const m = bodyText.match(regex);
      if (m) specs[`s${s}`] = parseFloat(m[1]);
    }
  }

  // 少なくとも s5 と s6 が取得できたら有効
  if (specs.s5 && specs.s6) {
    console.log(`[Lookup] 出率データ取得成功: 設定5=${specs.s5}%, 設定6=${specs.s6}%`);
    return specs;
  }

  return null;
}

/** デフォルトスペック（取得失敗時） */
function getDefaultSpecs() {
  return { 
    s1: 97.5, s2: 98.5, s3: 100.5, s4: 105.0, s5: 108.0, s6: 112.0,
    type: 'AT',
    hitCols: ['BB', 'RB', 'ART'],
    probThresholds: { s6: 220, s5: 240, s4: 260 }
  };
}

/**
 * スクレイプ結果の機種リストに対し、未登録機種を検索して追加
 * @param {string[]} machineNames - スクレイプで見つかった機種名一覧
 */
async function updateDBForNewMachines(machineNames) {
  const db = loadDB();
  const unknowns = [...new Set(machineNames)].filter(name => !db[name]);

  if (unknowns.length === 0) {
    console.log('[Lookup] 未知機種なし');
    return db;
  }

  console.log(`[Lookup] ${unknowns.length}件の未知機種を検索します: ${unknowns.join(', ')}`);

  for (const name of unknowns) {
    try {
      const specs = await lookupMachineSpecs(name);
      db[name] = specs;
      console.log(`[Lookup] ✅ ${name}: 設定5=${specs.s5}%, 設定6=${specs.s6}%`);
    } catch (e) {
      console.log(`[Lookup] ❌ ${name}: エラー → デフォルト値使用`);
      db[name] = getDefaultSpecs();
    }
    await sleep(1500); // サーバー負荷軽減
  }

  saveDB(db);
  console.log(`[Lookup] machine_db.json を更新しました (${Object.keys(db).length}機種)`);
  return db;
}

module.exports = { lookupMachineSpecs, updateDBForNewMachines, loadDB, getDefaultSpecs };
