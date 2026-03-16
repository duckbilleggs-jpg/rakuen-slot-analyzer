/**
 * test_ddelta_puppeteer_final.js - 実際のDOM構造に基づいたデータ抽出
 */
const puppeteer = require('puppeteer');

const DATA_LIST_URL = 'https://www.d-deltanet.com/pc/D3301.do?pmc=22021030&mdc=120122&bn=1&soc=1&sw=1&pan=1&urt=2173&tdd=0&dan=1';

async function run() {
  console.log('Launching browser (Final extraction)...');
  const browser = await puppeteer.launch({ 
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
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

    console.log(`2. Navigating to Data List page`);
    await page.goto(DATA_LIST_URL, { waitUntil: 'networkidle0', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));
    
    // データ抽出: tableではなく、d-deltanet特有のul/liやdivベースのリストを想定して全テキストを取得しパースする
    console.log(`\n--- Extracting Data ---`);
    const data = await page.evaluate(() => {
        const results = [];
        
        // 1. よくあるテーブルパターン
        document.querySelectorAll('table').forEach(tbl => {
            tbl.querySelectorAll('tr').forEach((tr, i) => {
                const cells = Array.from(tr.querySelectorAll('td, th')).map(c => c.innerText.trim());
                if (cells.length > 2) results.push({ type: 'table', row: cells.join(' | ') });
            });
        });

        // 2. リストパターン（ul > li）
        document.querySelectorAll('ul').forEach(ul => {
            ul.querySelectorAll('li').forEach(li => {
                const text = li.innerText.trim().replace(/\s+/g, ' ');
                if (text.includes('番台') || /\d+/.test(text)) {
                    results.push({ type: 'list', row: text });
                }
            });
        });
        
        // 3. データボックスパターン
        document.querySelectorAll('div').forEach(div => {
            const className = div.className || '';
            if (className.includes('data') || className.includes('list') || className.includes('box')) {
                const text = div.innerText.trim().replace(/\s+/g, ' ');
                // 台番（例: 0123）や回数が含まれていそうなものを抽出
                if (text.length > 15 && text.length < 200 && /\d+/.test(text)) {
                    results.push({ type: 'div', class: className, row: text });
                }
            }
        });

        return results;
    });
    
    // 重複を削除して整形
    const uniqueRows = new Set();
    const finalOutput = [];
    
    data.forEach(item => {
        if (!uniqueRows.has(item.row)) {
            uniqueRows.add(item.row);
            finalOutput.push(item);
        }
    });

    console.log(`Found ${finalOutput.length} potential data rows.`);
    finalOutput.filter(item => item.row.includes('回') || item.row.includes('番') || item.type === 'table')
               .slice(0, 20)
               .forEach((item, i) => {
        console.log(`[${i}] (${item.type}) ${item.row}`);
    });

  } catch (error) {
    console.error('Failed:', error);
  } finally {
    await browser.close();
  }
}

run();
