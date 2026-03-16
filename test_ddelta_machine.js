/**
 * test_ddelta_machine.js - 個別機種データページの調査スクリプト (リファラ・クッキー付与版)
 */
const https = require('https');
const cheerio = require('cheerio');
const fs = require('fs');
const iconv = require('iconv-lite');

const LIST_URL = 'https://www.d-deltanet.com/pc/D0301.do?pmc=22021030&clc=03&urt=2173&pan=1';
const TARGET_URL = 'https://www.d-deltanet.com/pc/D2301.do?pmc=22021030&clc=03&urt=2173&mdc=120122&bn=1';

// Cookieを保存する簡易的なストレージ
let cookies = [];

function fetch(url, isList = false) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Referer': LIST_URL // リファラを追加
      }
    };
    
    // Cookie の追加
    if (cookies.length > 0) {
      options.headers['Cookie'] = cookies.join('; ');
    }

    https.get(options, (res) => {
      console.log(`[${isList ? 'LIST' : 'TARGET'}] Status Code: ${res.statusCode} URL: ${url}`);
      
      // Cookieを保存
      if (res.headers['set-cookie']) {
          res.headers['set-cookie'].forEach(c => {
              const cookieStr = c.split(';')[0];
              if (!cookies.includes(cookieStr)) {
                  cookies.push(cookieStr);
              }
          });
      }

      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith('/')) {
            redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
        }
        return fetch(redirectUrl, isList).then(resolve, reject);
      }
      
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const html = iconv.decode(buffer, 'Shift_JIS');
        resolve(html);
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log('1. Fetching list page to get session cookies...');
  try {
    await fetch(LIST_URL, true);
    console.log(`Saved cookies: ${cookies.join(', ')}`);
    
    console.log('\n2. Fetching machine page:', TARGET_URL);
    const html = await fetch(TARGET_URL, false);
    fs.writeFileSync('ddelta_machine_test.html', html, 'utf-8');
    
    const $ = cheerio.load(html);
    const title = $('title').text().trim();
    console.log(`Page Title: ${title}`);
    
    if (title.includes('エラー')) {
        console.log('--- ERROR FOUND ---');
        console.log($('.error_box, .error').text().trim() || 'No specific error text found.');
        return;
    }

    // データ抽出テスト
    const tables = [];
    $('table').each((i, tbl) => {
        const rows = $(tbl).find('tr');
        if (rows.length > 0) {
            console.log(`\nTable ${i+1}:`);
            rows.each((j, row) => {
                const cells = $(row).find('td, th');
                const rowText = cells.map((k, c) => $(c).text().trim()).get().join(' | ');
                if (rowText) console.log(`  ${rowText}`);
            });
        }
    });
    
  } catch (error) {
    console.error('Fetch failed:', error);
  }
}

run();
