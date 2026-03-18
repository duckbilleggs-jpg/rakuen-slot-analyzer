const https = require('https');
const fs = require('fs');
const iconv = require('iconv-lite');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.d-deltanet.com/pc';
let cookies = [];

function fetch(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url.startsWith('http') ? url : `${BASE_URL}/${url}`);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      }
    };
    if (cookies.length > 0) options.headers['Cookie'] = cookies.join('; ');

    https.get(options, (res) => {
      if (res.headers['set-cookie']) {
          res.headers['set-cookie'].forEach(c => {
              const cookieStr = c.split(';')[0];
              if (!cookies.includes(cookieStr)) cookies.push(cookieStr);
          });
      }
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith('/')) redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
        return fetch(redirectUrl).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(iconv.decode(Buffer.concat(chunks), 'Shift_JIS')));
    }).on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchWithRetry(url, name) {
    let retries = 5;
    while (retries > 0) {
        console.log(`Fetching ${name}...`);
        const html = await fetch(url);
        if (html.includes('エラーページ') || html.includes('混み合っております')) {
            console.log(`[Rate Limit] System busy on ${name}. Waiting 3s...`);
            await sleep(3000);
            retries--;
        } else {
            return html;
        }
    }
    throw new Error(`Failed to fetch ${name} after retries.`);
}

async function run() {
  console.log('1. Portal URL -> Get cookies');
  await fetch(`${BASE_URL}/D0301.do?pmc=22021030&clc=03&urt=2173&pan=1`);
  const html0301 = await fetchWithRetry(`${BASE_URL}/D0301.do?pmc=22021030&clc=03&urt=2173&pan=1`, 'Portal');
  
  const d2301Match = html0301.match(/href="(D2301\.do\?[^"]+)"/);
  if (!d2301Match) { console.log('No D2301 found on portal'); return; }
  
  const html2301 = await fetchWithRetry(d2301Match[1].replace(/&amp;/g, '&'), 'Machine Page');
  
  const d3301Match = html2301.match(/href="(D3301\.do\?[^"]+)"/);
  if (!d3301Match) { console.log('No D3301 found on machine page'); return; }
  
  const html3301 = await fetchWithRetry(d3301Match[1].replace(/&amp;/g, '&'), 'Data 1 Page');
  fs.writeFileSync('ddelta_data1.html', html3301, 'utf-8');
  
  const $ = cheerio.load(html3301);
  let data2Link = null;
  $('a').each((i, el) => {
      const text = $(el).text();
      const href = $(el).attr('href');
      if (text.includes('データ2') || text.includes('データ２')) {
          data2Link = href;
      }
  });
  
  if (data2Link) {
      console.log('4. Fetching Data 2 Page:', data2Link);
      const htmlData2 = await fetchWithRetry(data2Link.replace(/&amp;/g, '&'), 'Data 2 Page');
      fs.writeFileSync('ddelta_data2.html', htmlData2, 'utf-8');
      console.log('Saved ddelta_data2.html');
      
      const $2 = cheerio.load(htmlData2);
      $2('table').each((i, table) => {
          console.log(`\nTable ${i+1}:`);
          $2(table).find('tr').each((j, tr) => {
              const cells = [];
              $2(tr).find('td, th').each((k, c) => cells.push($2(c).text().trim()));
              if (cells.length > 0) console.log(`  ${cells.join(' | ')}`);
          });
      });
  } else {
      console.log('No Data 2 link found.');
  }
}
run();
