/**
 * 1台だけクリックスルーでデータ取得テスト + HTML保存 + スクリーンショット
 */
const puppeteer = require('puppeteer');
const fs = require('fs');

async function run() {
    const browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,1080']
    });
    
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        // 1. ポータルページ
        console.log('STEP1: ポータルページ');
        await page.goto('https://www.d-deltanet.com/pc/D0301.do?pmc=22021030&clc=03&urt=2173&pan=1', { waitUntil: 'networkidle2' });
        
        try {
            const agreeBtn = await page.$('.agree button');
            if (agreeBtn) { await agreeBtn.click(); await new Promise(r => setTimeout(r, 1500)); }
        } catch (e) {}
        
        console.log('  Title:', await page.title());
        
        // 最初の機種をクリック
        console.log('STEP2: 最初の機種をクリック');
        const firstModel = await page.evaluateHandle(() => {
            const links = document.querySelectorAll('#model_link ul a');
            return links.length > 0 ? links[0] : null;
        });
        
        if (!firstModel || !firstModel.asElement()) {
            console.log('機種リンクが見つかりません！');
            // HTML保存
            fs.writeFileSync('debug_portal.html', await page.content(), 'utf-8');
            await page.screenshot({ path: 'debug_portal.png', fullPage: true });
            return;
        }
        
        const modelName = await page.evaluate(el => el.innerText.trim(), firstModel.asElement());
        console.log('  機種:', modelName);
        
        await firstModel.asElement().click();
        await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 1500));
        
        console.log('  Title:', await page.title());
        const isError1 = await page.evaluate(() => document.title.includes('エラー') || document.body.innerText.includes('表示できません'));
        console.log('  エラー?:', isError1);
        
        if (isError1) {
            fs.writeFileSync('debug_model_error.html', await page.content(), 'utf-8');
            await page.screenshot({ path: 'debug_model_error.png', fullPage: true });
            console.log('  → 機種ページでエラー。HTML/スクショ保存。');
            return;
        }
        
        // 大当り一覧をクリック
        console.log('STEP3: 「大当り一覧」をクリック');
        const dataLink = await page.evaluateHandle(() => {
            const links = Array.from(document.querySelectorAll('a'));
            return links.find(a => a.innerText.includes('大当り一覧'));
        });
        
        if (!dataLink || !dataLink.asElement()) {
            console.log('  大当り一覧リンクなし！');
            fs.writeFileSync('debug_model_page.html', await page.content(), 'utf-8');
            await page.screenshot({ path: 'debug_model_page.png', fullPage: true });
            return;
        }
        
        await dataLink.asElement().click();
        await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 2000));
        
        console.log('  Title:', await page.title());
        
        // ページの内容を確認
        const pageInfo = await page.evaluate(() => {
            const title = document.title;
            const bodyText = document.body.innerText.substring(0, 500);
            const tables = document.querySelectorAll('table');
            const tableInfo = [];
            tables.forEach((t, i) => {
                const rows = t.querySelectorAll('tr');
                const firstRowText = rows.length > 0 ? rows[0].innerText.trim().substring(0, 100) : '';
                tableInfo.push({ index: i, rows: rows.length, firstRow: firstRowText });
            });
            return { title, bodyText, tableCount: tables.length, tableInfo };
        });
        
        console.log('  Title:', pageInfo.title);
        console.log('  Body(先頭500文字):', pageInfo.bodyText);
        console.log('  テーブル数:', pageInfo.tableCount);
        pageInfo.tableInfo.forEach(t => console.log(`    Table${t.index}: ${t.rows}行, 先頭: ${t.firstRow}`));
        
        // HTML保存
        fs.writeFileSync('debug_data_list.html', await page.content(), 'utf-8');
        await page.screenshot({ path: 'debug_data_list.png', fullPage: true });
        console.log('  → HTML/スクショ保存完了');
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await browser.close();
    }
}

run();
