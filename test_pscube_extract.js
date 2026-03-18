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
        
        // Wait for the specific iframe to appear
        const iframeElement = await page.waitForSelector('iframe.dedama-iframe', {timeout: 10000});
        const frame = await iframeElement.contentFrame();
        
        if (!frame) {
            console.log('Could not find the content frame for dedama-iframe');
            return;
        }
        
        console.log('Waiting inside iframe for page to render...');
        // Wait for one of the main buttons
        await new Promise(r => setTimeout(r, 3000)); 
        
        // Let's get the HTML of the frame
        
        console.log('Finding Slot Data link...');
        const slotLink = await frame.$('a[href*="nc-v03-001.php?cd_ps=2"]');
        if (slotLink) {
            console.log('Clicking Slot Data link...');
            await slotLink.click();
            
            console.log('Waiting for machine list page to load...');
            await new Promise(r => setTimeout(r, 6000));
            
            const nextHtml = await frame.content();
            require('fs').writeFileSync('pscube_machines.html', nextHtml);
            console.log('Saved machine list HTML to pscube_machines.html');
            
        console.log('Finding a machine link (e.g. btn-ki)...');
        const machineLink = await frame.$('ul#ulKI a.btn-ki');
        
        if (machineLink) {
            console.log('Clicking the first machine link...');
            await machineLink.click();
            
            console.log('Waiting for machine detail page to load...');
            await new Promise(r => setTimeout(r, 6000));
            
            const detailHtml = await frame.content();
            require('fs').writeFileSync('pscube_machine_detail.html', detailHtml);
            console.log('Saved machine detail graph HTML to pscube_machine_detail.html');
            
            console.log('Clicking the DATA tab to see if it has Difference data...');
            const dataTabLink = await frame.$('a.nc-view-data');
            if (dataTabLink) {
                await dataTabLink.click();
                console.log('Waiting for DATA tab to load...');
                await new Promise(r => setTimeout(r, 6000));
                
                const dataHtml = await frame.content();
                require('fs').writeFileSync('pscube_machine_data.html', dataHtml);
                console.log('Saved machine DATA HTML to pscube_machine_data.html');
                
                await page.screenshot({ path: 'pscube_machine_data.png', fullPage: true });
                console.log('Saved screenshot to pscube_machine_data.png');
            } else {
                console.log('Could not find DATA tab link.');
            }
        } else {
            console.log('Could not find any machine links on the page.');
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
