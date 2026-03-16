/**
 * test_ddelta2.js - リアルタイムデータ取得先(d-deltanet)のクイック調査用スクリプト (Shift_JIS対応)
 */
const https = require('https');
const cheerio = require('cheerio');
const fs = require('fs');
const iconv = require('iconv-lite');

const TARGET_URL = 'https://www.d-deltanet.com/pc/D0301.do?pmc=22021030&clc=03&urt=2173&pan=1';

function fetch(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      }
    };
    https.get(url, options, (res) => {
      console.log(`Status Code: ${res.statusCode}`);
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith('/')) {
            const urlObj = new URL(url);
            redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
        }
        return fetch(redirectUrl).then(resolve, reject);
      }
      
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        // d-deltanetはShift_JISの可能性が高い
        const html = iconv.decode(buffer, 'Shift_JIS');
        resolve(html);
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log('Fetching d-deltanet page (Shift_JIS)...');
  try {
    const html = await fetch(TARGET_URL);
    fs.writeFileSync('ddelta_test.html', html, 'utf-8');
    console.log('Saved decoded HTML to ddelta_test.html');
    
    const $ = cheerio.load(html);
    const title = $('title').text().trim();
    console.log(`Page Title: ${title}`);
    
    // aタグのテキストとリンクを抽出
    const links = [];
    $('a').each((i, el) => {
        const text = $(el).text().trim().replace(/\s+/g, ' ');
        const href = $(el).attr('href');
        if (text && href && !href.startsWith('javascript:')) {
            links.push({text, href});
        }
    });
    
    console.log(`\n--- Links (${links.length}) ---`);
    links.forEach(l => console.log(`[${l.text}] -> ${l.href}`));

    // 何かテーブルデータっぽいのがあるか
    const tables = [];
    $('table').each((i, tbl) => {
        const rows = $(tbl).find('tr').length;
        if (rows > 0) {
            tables.push(`Table ${i+1}: ${rows} rows`);
        }
    });
    console.log(`\n--- Tables ---`);
    console.log(tables);
    
  } catch (error) {
    console.error('Fetch failed:', error);
  }
}

run();
