/**
 * test_ddelta_reload.js - エラー画面後に更新（リロード）を試すスクリプト
 */
const puppeteer = require('puppeteer');
const fs = require('fs');

const DATA_LIST_URL = 'https://www.d-deltanet.com/pc/D3301.do?pmc=22021030&mdc=120122&bn=1&soc=1&sw=1&pan=1&urt=2173&tdd=0&dan=1';

async function run() {
  console.log('Launching browser (Reload test)...');
  const browser = await puppeteer.launch({ 
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,1080']
  });
  
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    
    // 1. トップページでCookie取得
    console.log(`1. Navigating to top page`);
    await page.goto('https://www.d-deltanet.com/pc/D0301.do?pmc=22021030&clc=03&urt=2173&pan=1', { waitUntil: 'networkidle2' });
    
    try {
        const agreeBtn = await page.$('.agree button');
        if (agreeBtn) {
            await agreeBtn.click();
            await new Promise(r => setTimeout(r, 1000));
        }
    } catch (e) {}

    // 2. 目的のリストページへ遷移
    console.log(`2. Navigating to Data List page`);
    await page.goto(DATA_LIST_URL, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2000));
    
    // 現在のタイトルを確認
    let title = await page.title();
    console.log(`Initial Page Title: ${title}`);
    
    // もしエラーや混雑画面なら、指定通り「更新」をかける
    if (title.includes('エラー') || (await page.content()).includes('混み合っております')) {
        console.log(`\n--- System Busy / Error Detected. Triggering Reload ---`);
        console.log(`Waiting 3 seconds before reload...`);
        await new Promise(r => setTimeout(r, 3000));
        
        console.log(`Reloading page...`);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 3000)); // 再読み込み後の待機
        
        title = await page.title();
        console.log(`Page Title after reload: ${title}`);
    }
    
    // スクリーンショットを撮って視覚的に確認
    await page.screenshot({ path: 'ddelta_reload_screenshot.png', fullPage: true });
    console.log(`Saved screenshot to ddelta_reload_screenshot.png`);
    
    // 抽出処理も一応走らせておく
     const data = await page.evaluate(() => {
        const results = [];
        
        document.querySelectorAll('table').forEach((tbl, i) => {
            tbl.querySelectorAll('tr').forEach((tr, j) => {
                const cells = Array.from(tr.querySelectorAll('td, th')).map(c => c.innerText.trim());
                if (cells.length > 0) results.push(`Table ${i} Row ${j}: ${cells.join(' | ')}`);
            });
        });

        if (results.length === 0) {
             // tableがなければdivを見る
             document.querySelectorAll('div').forEach(div => {
                 const text = div.innerText.trim();
                 if (text.includes('番台') || (text.length > 20 && /\d+/.test(text))) {
                     results.push(`Div snippet: ${text.replace(/\s+/g, ' ').substring(0, 100)}`);
                 }
             });
        }
        
        return results;
    });
    
    // 重複を弾いて出力
    const uniqueData = [...new Set(data)];
    console.log(`\n--- Extracted Data (${uniqueData.length} items) ---`);
    uniqueData.slice(0, 20).forEach(item => console.log(item));

  } catch (error) {
    console.error('Failed:', error);
  } finally {
    await browser.close();
  }
}

run();
