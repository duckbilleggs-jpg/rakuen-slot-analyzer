const puppeteer = require('puppeteer');

(async () => {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log('Navigating to DMM P-Town...');
        await page.goto('https://p-town.dmm.com/shops/tokyo/148/jackpot', { waitUntil: 'networkidle2' });
        console.log('Waiting for iframe...');
        
        const iframeElement = await page.waitForSelector('iframe.dedama-iframe', {timeout: 10000});
        const frame = await iframeElement.contentFrame();
        
        if (!frame) {
            console.log('Could not find the content frame for dedama-iframe');
            return;
        }
        
        console.log('Waiting inside iframe for page to render...');
        await new Promise(r => setTimeout(r, 3000)); 
        
        console.log('Finding Slot Data link...');
        const slotLink = await frame.$('a[href*="nc-v03-001.php?cd_ps=2"]');
        if (slotLink) {
            console.log('Clicking Slot Data link...');
            await slotLink.click();
            
            console.log('Waiting for machine list page to load...');
            await new Promise(r => setTimeout(r, 6000));
            
            console.log('Extracting first 2 machine links...');
            const links = await frame.$$eval('ul#ulKI a.btn-ki', anchors => {
                return anchors.slice(0, 2).map(a => ({
                    name: a.querySelector('.nc-label') ? a.querySelector('.nc-label').innerText : 'Unknown',
                    href: a.href
                }));
            });
            console.log('Found links:', links);
            
            for (const link of links) {
                console.log(`\nFetching detail page for: ${link.name} (${link.href})...`);
                const html = await frame.evaluate(async (url) => {
                    try {
                        const response = await fetch(url);
                        return await response.text();
                    } catch (e) {
                        return 'Error: ' + e.message;
                    }
                }, link.href);
                
                console.log(`Fetched HTML length: ${html.length}`);
                if (html.includes('BIG') && html.includes('REG')) {
                    console.log(`[SUCCESS] Data successfully parsed for ${link.name}!`);
                } else {
                    console.log(`[FAIL] HTML does not contain expected data signatures.`);
                }
            }
        } else {
            console.log('Slot data link not found in iframe!');
        }
        
    } catch (e) {
        console.error('Error during scraping:', e);
    } finally {
        await browser.close();
    }
})();
