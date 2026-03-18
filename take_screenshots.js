const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
    const browser = await puppeteer.launch({
        headless: "new"
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1080 });
    
    console.log('Navigating to portal...');
    await page.goto('https://www.d-deltanet.com/pc/D0301.do?pmc=22021030&clc=03&urt=2173&pan=1', { waitUntil: 'networkidle2' });
    
    // Agree to cookie policy if present
    try {
        await page.waitForSelector('.overlay-cookie-policy button', { timeout: 3000 });
        await page.click('.overlay-cookie-policy button');
        await page.waitForTimeout(1000);
    } catch(e) {}
    
    console.log('Taking screenshot for portal...');
    await page.screenshot({ path: path.join(__dirname, 'portal_screenshot.png'), fullPage: true });
    
    // Also taking one of the machine page
    console.log('Navigating to machine page...');
    await page.goto('https://www.d-deltanet.com/pc/D2301.do?pmc=22021030&mdc=120312&bn=1&soc=1&sw=1&pan=1&urt=2173&tdd=0&dan=1', { waitUntil: 'networkidle2' });
    await page.screenshot({ path: path.join(__dirname, 'machine_screenshot.png'), fullPage: true });

    // Also taking one of the top page
    console.log('Navigating to top page...');
    await page.goto('https://www.d-deltanet.com/pc/D0101.do?pmc=22021030', { waitUntil: 'networkidle2' });
    await page.screenshot({ path: path.join(__dirname, 'top_screenshot.png'), fullPage: true });

    // Extract all links text
    const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a')).map(a => a.innerText.replace(/\s+/g, ' ').trim());
    });
    console.log('Top page links:', links.filter(l => l.length > 0).join(', '));
    
    console.log('Done.');
    await browser.close();
})();
