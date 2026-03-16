/**
 * test_ddelta_retry.js - エラー画面突破のためのリトライスクリプト
 */
const puppeteer = require('puppeteer');
const fs = require('fs');

const DATA_LIST_URL = 'https://www.d-deltanet.com/pc/D3301.do?pmc=22021030&mdc=120122&bn=1&soc=1&sw=1&pan=1&urt=2173&tdd=0&dan=1';

async function run() {
  console.log('Launching browser (Retry loop test)...');
  const browser = await puppeteer.launch({ 
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    
    // Cookie取得
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
    await page.goto(DATA_LIST_URL, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2000));
    
    // 最大5回リトライする
    const MAX_RETRIES = 5;
    for (let i = 1; i <= MAX_RETRIES; i++) {
        const title = await page.title();
        const content = await page.content();
        
        if (!title.includes('エラー') && !content.includes('混み合っております')) {
            console.log(`\nSuccess! Page loaded correctly on attempt ${i}. Title: ${title}`);
            break;
        }
        
        console.log(`\nAttempt ${i}: System Busy Detected. Reloading in 3 seconds...`);
        await new Promise(r => setTimeout(r, 3000));
        
        // ページ上の "更新" や "戻る" ではなくブラウザの再読み込みを試行
        await page.reload({ waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 3000));
        
        if (i === MAX_RETRIES) {
             console.log(`Failed to bypass error after ${MAX_RETRIES} attempts.`);
        }
    }
    
    // HTMLの保存
    const html = await page.content();
    fs.writeFileSync('ddelta_retry_result.html', html, 'utf-8');
    await page.screenshot({ path: 'ddelta_retry_screenshot.png', fullPage: true });
    
    // データ抽出処理
    const data = await page.evaluate(() => {
        const results = [];
        
        // tableタグ内のtrを探索
        document.querySelectorAll('table tr').forEach(tr => {
            const cells = Array.from(tr.querySelectorAll('td, th')).map(c => c.innerText.trim());
            // 空要素を除外して結合
            const validCells = cells.filter(c => c);
            if (validCells.length > 0) {
                 results.push(`Row: ${validCells.join(' | ')}`);
            }
        });
        
        return results;
    });
    
    console.log(`\n--- Extracted Data (${data.length} items) ---`);
    data.slice(0, 30).forEach(item => console.log(item));

  } catch (error) {
    console.error('Failed:', error);
  } finally {
    await browser.close();
  }
}

run();
