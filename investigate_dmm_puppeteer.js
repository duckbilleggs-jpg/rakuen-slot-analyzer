const puppeteer = require('puppeteer');

(async () => {
    console.log('Starting puppeteer to investigate DMM p-town data...');
    try {
        const browser = await puppeteer.launch({ headless: 'new' });
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // リクエストを監視して、データAPIらしきものを抽出
        page.on('response', async (response) => {
            const url = response.url();
            const type = response.request().resourceType();
            
            // iframeやXHR/Fetchリクエストを監視
            if (type === 'xhr' || type === 'fetch' || url.includes('data') || url.includes('api')) {
                console.log(`[Network] ${type}: ${url}`);
                try {
                    if ((type === 'xhr' || type === 'fetch') && url.includes('json')) {
                        const json = await response.json();
                        console.log(`[JSON Data Excerpt from ${url}]`, JSON.stringify(json).substring(0, 200));
                    }
                } catch (e) {
                    // Ignore parsing errors for non-JSON content
                }
            }
        });

        console.log('Navigating to DMM p-town Kinshicho (みとやジャックポット)...');
        await page.goto('https://p-town.dmm.com/shops/tokyo/148/jackpot', { waitUntil: 'networkidle2', timeout: 30000 });
        
        // iframeの src をログ出力
        const iframes = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('iframe')).map(i => i.src);
        });
        
        console.log('\n--- Iframe SRCs found on page ---');
        iframes.forEach(src => console.log(src));

        if (iframes.length > 0) {
            const dataIframe = iframes.find(src => src.includes('dedama') || src.includes('data'));
            if (dataIframe) {
                console.log(`\nNavigating directly to data iframe: ${dataIframe}`);
                await page.goto(dataIframe, { waitUntil: 'networkidle2', timeout: 30000 });
                const iframeContent = await page.content();
                console.log('Iframe content length:', iframeContent.length);
                console.log('Iframe contains machine names (e.g., ジャグラー)?', iframeContent.includes('ジャグラー'));
                
                // 内部のAPIリクエストを探る
                const innerIframes = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('iframe')).map(i => i.src);
                });
                console.log('Inner iframes:', innerIframes);
            }
        }

        await browser.close();
        console.log('Done.');
    } catch (e) {
        console.error('Error:', e);
    }
})();
