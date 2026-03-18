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
    
    // Check D3301 (大当り一覧)
    console.log('--- D3301 ---');
    const html1 = await fetchHTML('D3301.do?pmc=22021030&mdc=120312&bn=1&soc=1&sw=1&pan=1&urt=2173&tdd=0&dan=1');
    let $ = cheerio.load(html1);
    console.log($('body').text().replace(/\s+/g, ' ').substring(0, 500));
    
    // Check D2401 (出玉推移グラフ - gc=2)
    console.log('--- D2401 gc=2 ---');
    const html2 = await fetchHTML('D2401.do?pmc=22021030&mdc=120312&bn=1&gc=2&pan=1&clc=03&urt=2173');
    $ = cheerio.load(html2);
    console.log($('body').text().replace(/\s+/g, ' ').substring(0, 500));
    
    // Check D0401 (台番検索)
    console.log('--- D0401 ---');
    const html3 = await fetchHTML('D0401.do?pmc=22021030');
    $ = cheerio.load(html3);
    console.log($('body').text().replace(/\s+/g, ' ').substring(0, 500));

})();
