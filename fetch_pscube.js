const https = require('https');
const fs = require('fs');

const fetch = (url) => new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if ([301, 302, 303, 307].includes(res.statusCode) && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, url).toString();
            return fetch(redirectUrl).then(resolve).catch(reject);
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
        res.on('error', reject);
    }).on('error', reject);
});

(async () => {
    try {
        console.log("Fetching P'sCube slots list...");
        const html = await fetch('https://www.pscube.jp/h/c761601/cgi-bin/nc-v03-001.php?cd_ps=2');
        console.log(`Length: ${html.length}`);
        
        fs.writeFileSync('pscube_models.html', html);
        
        const modelsMatch = html.match(/class="[^"]*nc-text-ellipsis[^"]*"[^>]*>([^<]+)/gi);
        if (modelsMatch) {
            console.log(`Found ${modelsMatch.length} potential models/data lines.`);
            modelsMatch.slice(0, 5).forEach(m => console.log(' ->', m.replace(/<[^>]+>/g, '').trim()));
        } else {
            console.log("No nc-text-ellipsis classes found. Dumping some links:");
            const links = html.match(/href="[^"]+"/gi);
            if (links) links.slice(0, 10).forEach(l => console.log(l));
        }
    } catch (e) {
        console.error("Error:", e.message);
    }
})();
