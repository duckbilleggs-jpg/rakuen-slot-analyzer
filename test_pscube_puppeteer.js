const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
        const page = await browser.newPage();
        // Set a standard user agent to avoid being blocked if possible
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log("Navigating to DMM P-Town...");
        await page.goto('https://p-town.dmm.com/shops/tokyo/148/jackpot', { waitUntil: 'networkidle2' });
        
        console.log('Waiting for dynamic content to load...');
        await new Promise(r => setTimeout(r, 5000));
        
        const html = await page.content();
        fs.writeFileSync('pscube_pup_test.html', html);
        console.log(`Saved HTML (${html.length} bytes) to pscube_pup_test.html`);
        
        // Take a screenshot as well to see what the page looks like
        await page.screenshot({ path: 'pscube_pup_test.png', fullPage: true });
        console.log('Saved screenshot to pscube_pup_test.png');
        
    } catch (e) {
        console.error('Error during scraping:', e);
    } finally {
        await browser.close();
    }
})();
