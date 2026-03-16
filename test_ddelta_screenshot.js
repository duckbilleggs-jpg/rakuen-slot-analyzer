/**
 * test_ddelta_screenshot.js - スクリーンショット取得用スクリプト
 */
const puppeteer = require('puppeteer');

const DATA_LIST_URL = 'https://www.d-deltanet.com/pc/D3301.do?pmc=22021030&mdc=120122&bn=1&soc=1&sw=1&pan=1&urt=2173&tdd=0&dan=1';

async function run() {
  console.log('Launching browser for screenshot...');
  const browser = await puppeteer.launch({ 
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1080 });
    
    // User-Agentをさらに偽装
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    
    // トップページでCookie取得 (エラー回避のため必須)
    console.log(`1. Navigating to top page`);
    await page.goto('https://www.d-deltanet.com/pc/D0301.do?pmc=22021030&clc=03&urt=2173&pan=1', { waitUntil: 'networkidle2' });
    
    try {
        const agreeBtn = await page.$('.agree button');
        if (agreeBtn) {
            await agreeBtn.click();
            await new Promise(r => setTimeout(r, 1000)); 
        }
    } catch (e) {}

    // 目的のリストページへ遷移
    console.log(`2. Navigating to Data List page`);
    // waitUntilを少し緩める (混み合っているエラー回避のため)
    await page.goto(DATA_LIST_URL, { waitUntil: 'domcontentloaded' });
    
    // 少し待機してレンダリング完了を待つ
    await new Promise(r => setTimeout(r, 3000));
    
    console.log(`Taking screenshot...`);
    await page.screenshot({ path: 'ddelta_screenshot.png', fullPage: true });
    console.log(`Saved screenshot to ddelta_screenshot.png`);

  } catch (error) {
    console.error('Failed:', error);
  } finally {
    await browser.close();
  }
}

run();
