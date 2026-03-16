/**
 * test_ddelta_clickthrough.js - リンクを順にクリックして辿るテスト
 */
const puppeteer = require('puppeteer');
const fs = require('fs');

async function run() {
  console.log('Launching browser (Click-through test)...');
  const browser = await puppeteer.launch({ 
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,1080']
  });
  
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    
    // 1. トップページ（機種一覧）へ
    console.log(`1. Navigating to top page`);
    await page.goto('https://www.d-deltanet.com/pc/D0301.do?pmc=22021030&clc=03&urt=2173&pan=1', { waitUntil: 'networkidle2' });
    
    try {
        const agreeBtn = await page.$('.agree button');
        if (agreeBtn) {
            await agreeBtn.click();
            await new Promise(r => setTimeout(r, 1000));
        }
    } catch (e) {}
    
    // 2. 「Lスマスロ北斗の拳」のリンクを探してクリック
    console.log(`2. Clicking "Lスマスロ北斗の拳" link`);
    const targetModelLink = await page.evaluateHandle(() => {
        const links = Array.from(document.querySelectorAll('a'));
        return links.find(a => a.innerText.includes('Lスマスロ北斗の拳'));
    });

    if (targetModelLink && targetModelLink.asElement()) {
        await targetModelLink.asElement().click();
        await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 1000));
    } else {
        console.log('Model link not found!');
        return;
    }

    // 3. 「大当り一覧」のリンクを探してクリック
    console.log(`3. Clicking "大当り一覧" link`);
    const dataListLink = await page.evaluateHandle(() => {
        const links = Array.from(document.querySelectorAll('a'));
        return links.find(a => a.innerText.includes('大当り一覧'));
    });

    if (dataListLink && dataListLink.asElement()) {
        await dataListLink.asElement().click();
        await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 2000));
    } else {
         console.log('Data list link not found!');
         return;
    }
    
    // 現在のタイトルを確認
    const title = await page.title();
    console.log(`Final Page Title: ${title}`);
    
    // ページの内容を保存
    await page.screenshot({ path: 'ddelta_clickthrough.png', fullPage: true });
    
    // データ抽出処理
    const data = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('table tr').forEach(tr => {
            const cells = Array.from(tr.querySelectorAll('td, th')).map(c => c.innerText.trim());
            const validCells = cells.filter(c => c);
            if (validCells.length > 0) results.push(validCells.join(' | '));
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
