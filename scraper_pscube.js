const puppeteer = require('puppeteer');
const fs = require('fs');
const { analyzeRealtimeData } = require('./scraper_ddelta');

/**
 * P'sCube (錦糸町みとやジャックポット) のデータを取得するスクレイパー
 * DMM P-Town の iframe 経由でアクセスし、WAF を回避してデータを抽出します。
 */
async function scrapeDeltanetPscube() {
    console.log('[P\'sCube] Launching browser...');
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log('[P\'sCube] Navigating to DMM P-Town Kinshicho Jackpot...');
        // みとやジャックポット錦糸町のDMMページ
        await page.goto('https://p-town.dmm.com/shops/tokyo/148/jackpot', { waitUntil: 'networkidle2' });
        
        console.log('[P\'sCube] Waiting for iframe (dedama-iframe) to appear...');
        const iframeElement = await page.waitForSelector('iframe.dedama-iframe', {timeout: 10000});
        const frame = await iframeElement.contentFrame();
        
        if (!frame) {
            throw new Error('[P\'sCube] Could not find the content frame for dedama-iframe');
        }
        
        console.log('[P\'sCube] Waiting inside iframe for page to render...');
        await new Promise(r => setTimeout(r, 4000)); 
        
        console.log('[P\'sCube] Finding "Slot Data" link...');
        const slotLink = await frame.$('a[href*="nc-v03-001.php?cd_ps=2"]');
        if (!slotLink) {
            throw new Error('[P\'sCube] "Slot Data" link not found in iframe!');
        }
        
        console.log('[P\'sCube] Clicking "Slot Data" link and waiting for machine list...');
        await slotLink.click();
        await new Promise(r => setTimeout(r, 5000));
        
        // 全機種のリンク情報を抽出
        console.log('[P\'sCube] Extracting all machine links...');
        const links = await frame.$$eval('ul#ulKI a.btn-ki', anchors => {
            return anchors.map(a => ({
                name: a.querySelector('.nc-label') ? a.querySelector('.nc-label').innerText.trim() : 'Unknown',
                href: a.href
            }));
        });
        
        console.log(`[P\'sCube] Found ${links.length} machine models. Starting data fetch loop...`);
        const extractedData = [];
        let count = 1;
        
        // 各機種のURLに遷移してデータを抽出 (WAFとAjaxロードに対応するため実際の遷移を利用)
        for (const link of links) {
            console.log(`[P'sCube] Fetching (${count}/${links.length}) : ${link.name} ...`);
            count++;
            
            try {
                // Iframe内を直接ナビゲート
                await frame.goto(link.href, { waitUntil: 'networkidle2', timeout: 15000 });
                // Ajaxの描画とAmchartsの表示完了を待つ
                await new Promise(r => setTimeout(r, 2000));
                
                // データ抽出
                const machines = await frame.evaluate(() => {
                    const results = [];
                    const machineElements = document.querySelectorAll('li.li');
                    
                    for (const el of machineElements) {
                        const lineEl = el.querySelector('.line');
                        if (!lineEl) continue;
                        const machineNumber = lineEl.textContent.trim();
                        
                        // BIG, REG, Total Games, Current Games
                        const bigEl = el.querySelector('tr[data-key="toku1-count"] td:nth-child(2)');
                        const regEl = el.querySelector('tr[data-key="toku5-count"] td:nth-child(2)');
                        const totalGameEl = el.querySelector('tr[data-key="sum_game"] td:nth-child(2)');
                        const currentGameEl = el.querySelector('tr[data-key="game"] td:nth-child(2)');
                        
                        const parseNum = (elem) => {
                            if (!elem) return 0;
                            const text = elem.textContent.trim().replace(/,/g, '');
                            const num = parseInt(text, 10);
                            return isNaN(num) ? 0 : num;
                        };
                        
                        results.push({
                            台番: isNaN(parseInt(machineNumber, 10)) ? 0 : parseInt(machineNumber, 10),
                            BB回数: parseNum(bigEl),
                            RB回数: parseNum(regEl),
                            G数: parseNum(totalGameEl),
                            ART回数: 0,
                            最高出玉: 0, // 差枚数不明のため0
                            currentGames: parseNum(currentGameEl)
                        });
                    }
                    return results;
                });
                
                // link.name を追加してメイン配列へ結合
                for (let m of machines) {
                    m.機種名 = link.name;
                    extractedData.push(m);
                }
                
            } catch (e) {
                console.error(`[P'sCube] Error scraping ${link.name}:`, e.message);
            }
        }
        
        console.log(`[P\'sCube] Scraped data for ${extractedData.length} individual machines. Analyzing...`);
        return analyzeRealtimeData(extractedData);
        
    } finally {
        console.log('[P\'sCube] Closing browser...');
        await browser.close();
    }
}

// 単独実行時の動作
if (require.main === module) {
    (async () => {
        try {
            const data = await scrapeDeltanetPscube();
            console.log("=== First 3 Records ===");
            console.log(data.slice(0, 3));
            console.log("=== Last 3 Records ===");
            console.log(data.slice(-3));
            console.log(`Total: ${data.length} records`);
            fs.writeFileSync('test_pscube_data.json', JSON.stringify(data, null, 2));
        } catch (e) {
            console.error('Scraping error:', e);
        }
    })();
}

module.exports = { scrapeDeltanetPscube };
