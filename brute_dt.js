const https = require('https');
const iconv = require('iconv-lite');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.d-deltanet.com/pc';
let sessionCookies = '';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function fetchHTML(urlPath) {
    const fullUrl = urlPath.startsWith('http') ? urlPath : `${BASE_URL}/${urlPath}`;
    return new Promise((resolve, reject) => {
        const req = https.get(fullUrl, { headers: { 'User-Agent': USER_AGENT, 'Cookie': sessionCookies } }, (res) => {
            if (res.headers['set-cookie']) {
                sessionCookies = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
            }
            if ([301, 302, 303, 307].includes(res.statusCode) && res.headers.location) {
                return fetchHTML(res.headers.location.startsWith('http') ? res.headers.location : `${BASE_URL}/${res.headers.location}`).then(resolve, reject);
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buf = Buffer.concat(chunks);
                let html;
                try { html = iconv.decode(buf, 'Shift_JIS'); } catch(e) { html = buf.toString('latin1'); }
                resolve(html);
            });
            res.on('error', reject);
        });
        req.on('error', reject);
    });
}

(async () => {
    await fetchHTML('https://www.d-deltanet.com/');
    await fetchHTML(`${BASE_URL}/CommonSetCookie.do?key=cookie.policy.portal.agree&value=1678927575000`);
    
    console.log('--- Brute-forcing D2901.do dt=0 to 20 ---');
    for (let dt = 0; dt <= 20; dt++) {
        const url = `D2901.do?pmc=22021030&mdc=120312&bn=1&soc=1&sw=1&pan=1&dan=1&urt=2173&dt=${dt}`;
        const html = await fetchHTML(url);
        if (html.includes('エラーページ') || html.includes('準備中')) continue;
        const $ = cheerio.load(html);
        const title = $('#header').text().replace(/\s+/g, ' ').trim();
        const ths = [];
        $('.table_head').each((i, el) => { ths.push($(el).text().trim()); });
        if (ths.length > 0) {
            console.log(`dt=${dt}: [Title: ${title}] Headers: ${ths.join(', ')}`);
        }
    }
    
    console.log('--- Done ---');
})();
