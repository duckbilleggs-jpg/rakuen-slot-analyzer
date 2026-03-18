const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    const browser = await puppeteer.launch({headless:true, args:['--no-sandbox']});
    try {
        const page = await browser.newPage();
        await page.goto('https://p-town.dmm.com/shops/tokyo/148/jackpot', {waitUntil:'networkidle2'});
        const iframe = await page.waitForSelector('iframe.dedama-iframe');
        const frame = await iframe.contentFrame();
        await new Promise(r=>setTimeout(r, 4000));
        const slotLink = await frame.$('a[href*="nc-v03-001.php"]');
        await slotLink.click();
        await new Promise(r=>setTimeout(r, 5000));
        
        const link = await frame.$eval('ul#ulKI a.btn-ki', a => a.href);
        const html = await frame.evaluate(async (url) => { 
            const r = await fetch(url); 
            return await r.text(); 
        }, link);
        
        fs.writeFileSync('pscube_test_raw.html', html);
        console.log('Saved pscube_test_raw.html');
    } finally {
        await browser.close();
    }
})();
