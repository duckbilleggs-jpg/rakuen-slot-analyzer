const https = require('https');
const fs = require('fs');
const iconv = require('iconv-lite');
const cheerio = require('cheerio');

const LIST_URL = 'https://www.d-deltanet.com/pc/D0301.do?pmc=22021030&clc=03&urt=2173&pan=1';
const TARGET_URL = 'https://www.d-deltanet.com/pc/D2301.do?pmc=22021030&clc=03&urt=2173&mdc=120122&bn=1';

let cookies = [];

function fetch(url, isList = false) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': LIST_URL
      }
    };
    
    if (cookies.length > 0) {
      options.headers['Cookie'] = cookies.join('; ');
    }

    https.get(options, (res) => {
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
  await fetch(LIST_URL, true);
  
  console.log('2. Fetching machine page:', TARGET_URL);
  const html2301 = await fetch(TARGET_URL, false);
  
  const decoded2301 = html2301.replace(/&amp;/g, '&');
  const d3301Match = decoded2301.match(/href="(D3301\.do\?[^"]+)"/);
  
  if (!d3301Match) {
      console.log('D3301 link not found');
      return;
  }
  
  const d3301Url = `https://www.d-deltanet.com/pc/${d3301Match[1]}`;
  console.log('3. Fetching Data 1 page:', d3301Url);
  const html3301 = await fetch(d3301Url, false);
  fs.writeFileSync('ddelta_data1.html', html3301, 'utf-8');
  console.log('Saved ddelta_data1.html');
  
  const $ = cheerio.load(html3301);
  let data2Link = null;
  $('a').each((i, el) => {
      const text = $(el).text();
      const href = $(el).attr('href');
      console.log(`Link text: "${text}", href: ${href}`);
      if (text.includes('データ2') || text.includes('データ２') || text.includes('差枚') || text.includes('出玉')) {
          data2Link = href;
      }
  });
  
  if (data2Link) {
      const dData2Url = `https://www.d-deltanet.com/pc/${data2Link.replace(/&amp;/g, '&')}`;
      console.log('\n4. Fetching Data 2 page:', dData2Url);
      const htmlData2 = await fetch(dData2Url, false);
      fs.writeFileSync('ddelta_data2.html', htmlData2, 'utf-8');
      console.log('Saved ddelta_data2.html');
  } else {
      console.log('\nCould not clearly identify Data 2 link. Try looking at ddelta_data1.html manually.');
  }

}

run();
