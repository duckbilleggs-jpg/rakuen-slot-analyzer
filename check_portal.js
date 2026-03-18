const https = require('https');
const iconv = require('iconv-lite');
const fs = require('fs');

const BASE_URL = 'https://www.d-deltanet.com/pc';
let sessionCookies = '';
let lastAccessUrl = '';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function fetchHTML(urlPath) {
    const fullUrl = urlPath.startsWith('http') ? urlPath : `${BASE_URL}/${urlPath}`;
    return new Promise((resolve, reject) => {
        const doRequest = (url, redirectCount = 0) => {
            if (redirectCount > 5) return reject(new Error('リダイレクト回数超過'));
            const headers = { 'User-Agent': USER_AGENT };
            if (sessionCookies) headers['Cookie'] = sessionCookies;
            if (lastAccessUrl) headers['Referer'] = lastAccessUrl;
            
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
                    const newUrl = res.headers.location.startsWith('http') 
                        ? res.headers.location : `${BASE_URL}/${res.headers.location}`;
                    return doRequest(newUrl, redirectCount + 1);
                }
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    const buf = Buffer.concat(chunks);
                    let html;
                    try {
                        html = iconv.decode(buf, 'Shift_JIS');
                    } catch (e) {
                        html = buf.toString('latin1');
                    }
                    lastAccessUrl = url;
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
    console.log('Session Init...');
    await fetchHTML('https://www.d-deltanet.com/');
    await fetchHTML(`${BASE_URL}/CommonSetCookie.do?key=cookie.policy.portal.agree&value=1678927575000`);
    
    console.log('Fetching Portal...');
    const portalHtml = await fetchHTML('D0301.do?pmc=22021030&clc=03&urt=2173&pan=1');
    fs.writeFileSync('portal_debug.html', portalHtml, 'utf8');
    console.log('Saved to portal_debug.html');
})();
