const https = require('https');
const iconv = require('iconv-lite');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.d-deltanet.com/pc';
let sessionCookies = '';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function fetchHTML(urlPath) {
    const fullUrl = urlPath.startsWith('http') ? urlPath : `${BASE_URL}/${urlPath}`;
    return new Promise((resolve, reject) => {
        const doRequest = (url) => {
            const headers = { 'User-Agent': USER_AGENT };
            if (sessionCookies) headers['Cookie'] = sessionCookies;
            const req = https.get(url, { headers }, (res) => {
                if (res.headers['set-cookie']) {
                    const cookieMap = {};
                    (sessionCookies ? sessionCookies.split('; ') : []).forEach(c => {
                        const [k] = c.split('='); cookieMap[k] = c;
                    });
                    res.headers['set-cookie'].forEach(c => {
                        const p = c.split(';')[0]; const [k] = p.split('='); cookieMap[k] = p;
                    });
                    sessionCookies = Object.values(cookieMap).join('; ');
                }
                if ([301, 302, 303, 307].includes(res.statusCode) && res.headers.location) {
                    const newUrl = res.headers.location.startsWith('http') ? res.headers.location : `${BASE_URL}/${res.headers.location}`;
                    return doRequest(newUrl);
                }
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    const buf = Buffer.concat(chunks);
                    let html;
                    try { html = iconv.decode(buf, 'Shift_JIS'); } catch (e) { html = buf.toString('latin1'); }
                    resolve(html);
                });
                res.on('error', reject);
            });
            req.on('error', reject);
        };
        doRequest(fullUrl);
    });
}

(async () => {
    await fetchHTML('https://www.d-deltanet.com/');
    await fetchHTML(`${BASE_URL}/CommonSetCookie.do?key=cookie.policy.portal.agree&value=1678927575000`);
    
    // Test base D2901 URL (ネオアイムジャグラーEX)
    const baseUrl = 'D2901.do?pmc=22021030&mdc=120312&bn=1&soc=1&sw=1&pan=1&dan=1&urt=2173&dt=';
    
    for (let i = 0; i <= 9; i++) {
        const html = await fetchHTML(baseUrl + i);
        const $ = cheerio.load(html);
        const title = $('#header').text().replace(/\s+/g, ' ').trim();
        console.log(`dt=${i}: ${title}`);
    }
    
    // Check D2401 as well
    const gcUrl = 'D2401.do?pmc=22021030&mdc=120312&bn=1&pan=1&clc=03&urt=2173&gc=';
    for (let i = 1; i <= 5; i++) {
        const html = await fetchHTML(gcUrl + i);
        const $ = cheerio.load(html);
        const title = $('#header').text().replace(/\s+/g, ' ').trim();
        console.log(`gc=${i}: ${title}`);
    }
})();
