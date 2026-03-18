const puppeteer = require('puppeteer');
const fs = require('fs');

const DATA_LIST_URL = 'https://www.d-deltanet.com/pc/D3301.do?pmc=22021030&mdc=120122&bn=1&soc=1&sw=1&pan=1&urt=2173&tdd=0&dan=1';

async function run() {
  console.log('Launching browser (Reload test + Data 2)...');
  const browser = await puppeteer.launch({ 
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,1080']
  });
  
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    
    console.log(`1. Navigating to top page`);
    await page.goto('https://www.d-deltanet.com/pc/D0301.do?pmc=22021030&clc=03&urt=2173&pan=1', { waitUntil: 'networkidle2' });
    
    try {
        const agreeBtn = await page.$('.agree button');
        if (agreeBtn) {
            await agreeBtn.click();
            await new Promise(r => setTimeout(r, 1000));
        }
    } catch (e) {}

    console.log(`2. Navigating to Data 1 page`);
    await page.goto(DATA_LIST_URL, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2000));
    
    let title = await page.title();
    console.log(`Initial Page Title: ${title}`);
    
    if (title.includes('エラー') || (await page.content()).includes('混み合っております')) {
        console.log(`System Busy Detected. Reloading in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 3000));
    }
    
    const html1 = await page.content();
    fs.writeFileSync('ddelta_data1_pup.html', html1, 'utf-8');
    
    // Find Data 2 link
    const data2Url = await page.evaluate(() => {
        let found = null;
        document.querySelectorAll('a').forEach(a => {
            if (a.innerText.includes('データ2') || a.innerText.includes('データ２')) {
                found = a.href;
            }
        });
        return found;
    });
    
    if (data2Url) {
        console.log(`3. Found Data 2 URL: ${data2Url}`);
        console.log(`Navigating to Data 2...`);
        await page.goto(data2Url, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 2000));
        
        let title2 = await page.title();
        if (title2.includes('エラー') || (await page.content()).includes('混み合っております')) {
            console.log(`System Busy Detected on Data 2. Reloading in 3s...`);
            await new Promise(r => setTimeout(r, 3000));
            await page.reload({ waitUntil: 'domcontentloaded' });
            await new Promise(r => setTimeout(r, 3000));
        }
        
        const html2 = await page.content();
        fs.writeFileSync('ddelta_data2_pup.html', html2, 'utf-8');
        console.log(`Saved Data 2 HTML to ddelta_data2_pup.html`);
        await page.screenshot({ path: 'ddelta_data2_screenshot.png', fullPage: true });
    } else {
        console.log('Data 2 link not found visually.');
    }

  } catch (error) {
    console.error('Failed:', error);
  } finally {
    await browser.close();
  }
}

run();
