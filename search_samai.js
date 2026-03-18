const https = require('https');
const iconv = require('iconv-lite');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.d-deltanet.com/pc';
let sessionCookies = '';
let lastAccessUrl = '';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function fetchHTML(urlPath) {
    const fullUrl = urlPath.startsWith('http') ? urlPath : `${BASE_URL}/${urlPath}`;
    return new Promise((resolve, reject) => {
        const doRequest = (url) => {
            const headers = { 'User-Agent': USER_AGENT };
            if (sessionCookies) headers['Cookie'] = sessionCookies;
            if (lastAccessUrl) headers['Referer'] = lastAccessUrl;
            lastAccessUrl = url;
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
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    const buf = Buffer.concat(chunks);
                    let html;
                    try { html = iconv.decode(buf, 'Shift_JIS'); } catch (e) { html = buf.toString('latin1'); }
                    resolve({ html, statusCode: res.statusCode, location: res.headers.location });
                });
                res.on('error', reject);
            });
            req.on('error', reject);
        };
        doRequest(fullUrl);
    });
}

(async () => {
    try {
        await fetchHTML('https://www.d-deltanet.com/');
        await fetchHTML(`${BASE_URL}/CommonSetCookie.do?key=cookie.policy.portal.agree&value=1678927575000`);
        
        let targetUrls = [
            'D0101.do?pmc=22021030',
            'D0301.do?pmc=22021030&clc=03&urt=2173&pan=1',
            'D1101.do?pmc=22021030',
            'D2301.do?pmc=22021030&mdc=120312&bn=1&soc=1&sw=1&pan=1&urt=2173&tdd=0&dan=1'
        ];
        
        let found = [];
        for (let url of targetUrls) {
            console.log(`Checking ${url}...`);
            const res = await fetchHTML(url);
            if (res.location) {
                console.log(`  -> Redirects to ${res.location}`);
                const res2 = await fetchHTML(res.location);
                let $ = cheerio.load(res2.html);
                $('a').each((i, el) => {
                    const text = $(el).text();
                    if (text.includes('差枚') || text.includes('差玉') || text.includes('獲得') || text.includes('出玉')) {
                        found.push(`[${text.trim()}] -> ${$(el).attr('href')}`);
                    }
                });
            } else {
                let $ = cheerio.load(res.html);
                $('a').each((i, el) => {
                    const text = $(el).text();
                    if (text.includes('差枚') || text.includes('差玉') || text.includes('獲得') || text.includes('出玉')) {
                        found.push(`[${text.trim()}] -> ${$(el).attr('href')}`);
                    }
                });
            }
        }
        
        console.log('\n--- FINDINGS ---');
        console.log(Array.from(new Set(found)).join('\n'));
    } catch(e) {
        console.error(e);
    }
})();
