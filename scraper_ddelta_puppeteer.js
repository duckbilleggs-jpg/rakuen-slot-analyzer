/**
 * scraper_ddelta_puppeteer.js — Puppeteerで人間操作を模倣してd-deltanetからデータを取得
 *
 * HTTP GETではボット検知されるケース（PNW500034エラー）向けの代替スクレイパー。
 * 実際のChromeブラウザを操作し、リンクのクリック・ランダム待機・スクロール等を行う。
 * 解析ロジックはscraper_ddelta.jsの analyzeRealtimeData をそのまま流用。
 */
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { loadDB, getDefaultSpecs } = require('./machine_lookup');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));

const BASE_URL = 'https://www.d-deltanet.com/pc';

/** ランダム待機 (min〜max ms) */
function sleep(min, max = null) {
    const ms = max ? min + Math.floor(Math.random() * (max - min)) : min;
    return new Promise(r => setTimeout(r, ms));
}

/** 人間っぽいスクロール */
async function humanScroll(page) {
    await page.evaluate(() => {
        const distance = 100 + Math.floor(Math.random() * 400);
        window.scrollBy(0, distance);
    });
    await sleep(300, 700);
}

/**
 * ブラウザページを初期化し、d-deltanetのセッションを確立
 * トップ → Cookie承諾 → 対象店舗のポータルへ
 */
async function initPage(browser, storeConfig) {
    const page = await browser.newPage();
    
    // リアルなスクリーンサイズ
    await page.setViewport({ width: 1280, height: 900 });
    
    // 実際のChromeのUser-Agentと各種ヘッダー
    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
    });

    // 1. まずトップページ
        await page.goto('https://www.d-deltanet.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(1000, 2000);

    // 2. Cookie同意ボタンがあればクリック
    try {
        const agreeBtn = await page.$('button.agree, .cookie-agree, .btn-agree, [class*="agree"]');
        if (agreeBtn) {
                        await agreeBtn.click();
            await sleep(800, 1500);
        }
    } catch (e) { /* なくてもOK */ }

    // 3. Cookie承諾API（HTTP GET方式と同様）
    try {
        await page.goto(
            `${BASE_URL}/CommonSetCookie.do?key=cookie.policy.portal.agree&value=1678927575000`,
            { waitUntil: 'domcontentloaded', timeout: 15000 }
        );
        await sleep(500, 1000);
    } catch (e) { /* 無視してよい */ }

    return page;
}

/**
 * ポータルページから機種リストを取得（ページネーション対応）
 */
async function fetchModelListPuppeteer(page, storeConfig) {
    const { pmc, clc, urt } = storeConfig.ddelta;
    const allModels = [];
    let pageNum = 1;

    while (true) {
        const url = `${BASE_URL}/D0301.do?pmc=${pmc}&clc=${clc}&urt=${urt}&pan=${pageNum}`;
                
        let html = null;
        let retries = 4;
        
        while (retries > 0) {
            try {
                const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await sleep(1000, 2000);
                await humanScroll(page);
                
                const content = await page.content();
                
                if (content.includes('PNW500034') || content.includes('混み合って')) {
                                        await sleep(5000, 8000);
                    retries--;
                    continue;
                }
                
                html = content;
                break;
            } catch (e) {
                                await sleep(3000, 5000);
                retries--;
            }
        }
        
        if (!html) {
                        if (pageNum === 1) return [];
            break;
        }

        // 機種名リンクを抽出
        const $ = cheerio.load(html);
        let pageCount = 0;
        
        $('a[href*="D2301.do"]').each((_, el) => {
            const href = $(el).attr('href').replace(/&amp;/g, '&');
            let name = $(el).text().replace(/<[^>]+>/g, '').trim();
            name = name.replace(/\[\d+\]/, '').replace(/\s+/g, ' ').trim();
            if (name && name.length > 1 && !name.includes('すべて')) {
                allModels.push({ name, url: href.startsWith('http') ? href : `${BASE_URL}/${href}` });
                pageCount++;
            }
        });
        
                
        // 次ページが存在するか確認
        if (!html.includes(`pan=${pageNum + 1}`)) break;
        pageNum++;
        await sleep(1500, 3000); // ページ間の待機
    }

    return allModels;
}

/**
 * 機種ページ → 大当り一覧ページを順にたどってデータ取得
 */
async function fetchModelDataPuppeteer(page, modelInfo) {
    const { name, url } = modelInfo;

    // Step 1: 機種ページへ移動
    let html;
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(800, 1500);
        await humanScroll(page);
        html = await page.content();
    } catch (e) {
                return [];
    }

    if (html.includes('エラーページ') || html.includes('表示できません')) {
        return [];
    }

    if (html.includes('PNW500034') || html.includes('混み合って')) {
                await sleep(5000, 8000);
        return [];
    }

    // Step 2: 大当り一覧リンクを探す（クリックで移動 or URL構築）
    const $ = cheerio.load(html.replace(/&amp;/g, '&'));
    let dataListUrl = null;
    
    $('a').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (href.includes('D3301.do') || href.includes('D2901.do')) {
            dataListUrl = href.startsWith('http') ? href : `${BASE_URL}/${href}`;
        }
    });

    if (!dataListUrl) {
                return [];
    }

    // Step 3: データ1ページ取得
    let dataHtml = await fetchPageWithRetryPuppeteer(page, dataListUrl);
    if (!dataHtml) return [];

    // Step 4: データ2のURLを探す
    const $d = cheerio.load(dataHtml);
    let data2Url = null;
    $d('a').each((_, el) => {
        const text = $d(el).text();
        const href = $d(el).attr('href') || '';
        if ((text.includes('データ2') || text.includes('データ２')) && href.includes('.do?')) {
            data2Url = href.startsWith('http') ? href : `${BASE_URL}/${href.replace(/&amp;/g, '&')}`;
        }
    });
    
    // dan=1 → dan=2 フォールバック
    if (!data2Url && dataListUrl.includes('dan=')) {
        data2Url = dataListUrl.replace(/dan=\d+/, 'dan=2');
    }

    let data2Html = '';
    if (data2Url) {
        await sleep(800, 1500);
        data2Html = await fetchPageWithRetryPuppeteer(page, data2Url) || '';
    }

        return parseDataTable(dataHtml, data2Html, name);
}

/** 混雑エラー時リトライ付きページ取得 */
async function fetchPageWithRetryPuppeteer(page, url) {
    let retries = 3;
    while (retries > 0) {
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await sleep(800, 1500);
            const html = await page.content();
            
            if (html.includes('PNW500034') || html.includes('混み合って') || html.includes('エラーページ')) {
                                await sleep(6000, 10000);
                retries--;
                continue;
            }
            return html;
        } catch (e) {
                        retries--;
            await sleep(3000, 5000);
        }
    }
    return null;
}

/**
 * HTMLテーブルからデータをパース（scraper_ddelta.jsのparseDataTableと同一ロジック）
 */
function parseDataTable(html1, html2, modelName) {
    const rows = [];
    
    let colIdx1 = { 台番: -1, G数: -1, BB: -1, RB: -1, ART: -1 };
    const $1 = cheerio.load(html1);
    const headerRow1 = $1('tr:has(td.table_head)').first();
    headerRow1.find('td').each((idx, cell) => {
        const text = $1(cell).text().trim();
        if (text.includes('台番')) colIdx1.台番 = idx;
        else if (text.includes('累計G') || text.includes('累計ゲーム') || text.includes('ゲーム')) colIdx1.G数 = idx;
        else if (text.includes('BB')) colIdx1.BB = idx;
        else if (text.includes('RB')) colIdx1.RB = idx;
        else if (text.includes('ART')) colIdx1.ART = idx;
    });

    if (colIdx1.台番 === -1 || colIdx1.G数 === -1) return [];

    $1('tr').each((_, tr) => {
        const $tr = $1(tr);
        if ($tr.find('.table_head, .table_foot').length > 0) return;
        const cells = $tr.find('td').map((_, td) => $1(td).text().trim()).get();
        if (cells.length < 2) return;
        const 台番 = parseInt(cells[colIdx1.台番].replace(/,/g, ''));
        if (!isNaN(台番)) {
            rows.push({
                機種名: modelName,
                台番,
                G数: parseInt(cells[colIdx1.G数].replace(/,/g, '')) || 0,
                BB回数: colIdx1.BB !== -1 ? (parseInt(cells[colIdx1.BB].replace(/,/g, '')) || 0) : 0,
                RB回数: colIdx1.RB !== -1 ? (parseInt(cells[colIdx1.RB].replace(/,/g, '')) || 0) : 0,
                ART回数: colIdx1.ART !== -1 ? (parseInt(cells[colIdx1.ART].replace(/,/g, '')) || 0) : 0,
                最高出玉: 0
            });
        }
    });

    // Data2: 最高出玉
    if (html2) {
        const $2 = cheerio.load(html2);
        let colIdx2 = { 台番: -1, 最高出玉: -1 };
        const headerRow2 = $2('tr:has(td.table_head)').first();
        headerRow2.find('td').each((idx, cell) => {
            const text = $2(cell).text().trim();
            if (text.includes('台番')) colIdx2.台番 = idx;
            else if (text.includes('最高') || text.includes('差枚') || text.includes('出玉')) colIdx2.最高出玉 = idx;
        });
        if (colIdx2.台番 !== -1 && colIdx2.最高出玉 !== -1) {
            $2('tr').each((_, tr) => {
                const $tr = $2(tr);
                if ($tr.find('.table_head, .table_foot').length > 0) return;
                const cells = $tr.find('td').map((_, td) => $2(td).text().trim()).get();
                if (cells.length < 2) return;
                const 台番 = parseInt(cells[colIdx2.台番].replace(/,/g, ''));
                if (!isNaN(台番)) {
                    const maxOut = parseInt(cells[colIdx2.最高出玉].replace(/,/g, ''));
                    const target = rows.find(r => r.台番 === 台番);
                    if (target && !isNaN(maxOut)) target.最高出玉 = maxOut;
                }
            });
        }
    }
    return rows;
}

/**
 * メイン: Puppeteerでd-deltanetから全機種リアルタイムデータを取得
 */
async function scrapeDDeltaPuppeteer(onProgress, storeConfig = null) {
    if (!storeConfig) {
        storeConfig = config.stores.find(s => s.id === 'rakuen_ikebukuro');
    }
    
    const browser = await puppeteer.launch({
        headless: 'new',          // ヘッドレスChrome (new方式)
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',  // 自動化フラグを隠す
            '--window-size=1280,900'
        ],
        defaultViewport: null
    });

    try {
        const page = await initPage(browser, storeConfig);

        // navigator.webdriverを隠してボット検知を回避
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        // Step 1: 機種リスト取得
        const models = await fetchModelListPuppeteer(page, storeConfig);
        if (models.length === 0) {
                        return [];
        }
        
        const results = [];
        for (let i = 0; i < models.length; i++) {
            const model = models[i];
                        if (onProgress) onProgress(i + 1, models.length, model.name);

            try {
                const data = await fetchModelDataPuppeteer(page, model);
                if (data.length > 0) {
                                        results.push(...data);
                } else {
                                    }
            } catch (err) {
                            }

            // 機種間のランダム待機（人間っぽく）
            await sleep(1200, 2500);
        }

        
        // ====================================================
        // 台番ホワイトリスト & 機種→台番マッピングを自動更新
        // 新台入替で台番・機種名が変わっても自動追従するため
        // ====================================================
        if (results.length > 0) {
            const slot46Numbers = [...new Set(results.map(m => m.台番))].sort((a, b) => a - b);
            try {
                fs.writeFileSync(
                    path.join(__dirname, `slot46_${storeConfig.id}.json`),
                    JSON.stringify(slot46Numbers, null, 2),
                    'utf8'
                );
                console.log(`[PUP] 台番ホワイトリスト更新: ${slot46Numbers.length}台 → slot46_${storeConfig.id}.json`);
            } catch (e) {
                console.log(`[PUP] 台番リスト保存失敗: ${e.message}`);
            }

            // 機種名→台番マッピングも保存
            try {
                const machineMap = {};
                for (const m of results) {
                    if (!machineMap[m.機種名]) machineMap[m.機種名] = [];
                    machineMap[m.機種名].push(m.台番);
                }
                for (const name of Object.keys(machineMap)) {
                    machineMap[name].sort((a, b) => a - b);
                }
                fs.writeFileSync(
                    path.join(__dirname, `machine_map_${storeConfig.id}.json`),
                    JSON.stringify(machineMap, null, 2),
                    'utf8'
                );
                console.log(`[PUP] 機種→台番マッピング更新 → machine_map_${storeConfig.id}.json`);
            } catch (e) { /* 保存失敗は無視 */ }
        } else {
            console.log('[PUP] 取得台数0のため台番ホワイトリストは更新しません（前回のデータを保持）');
        }

        // scraper_ddelta.jsの analyzeRealtimeData を流用
        const { analyzeRealtimeData } = require('./scraper_ddelta');
        return analyzeRealtimeData(results);

    } finally {
        await browser.close();
            }
}

// --- 単体テスト用 ---
if (require.main === module) {
    (async () => {
        const args = process.argv.slice(2);
        let storeId = 'rakuen_ikebukuro';
        for (let i = 0; i < args.length; i++) {
            if (args[i] === '--store' && args[i + 1]) storeId = args[++i];
        }
        const storeConfig = config.stores.find(s => s.id === storeId);
        if (!storeConfig) {
            console.error(`[PUP] エラー: '${storeId}' がconfig.jsonに見つかりません`);
            process.exit(1);
        }
        const results = await scrapeDDeltaPuppeteer(null, storeConfig);
                const high = results.filter(m => m.推定設定 >= 5);
                    })();
}

module.exports = { scrapeDDeltaPuppeteer };

