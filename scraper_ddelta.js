/**
 * scraper_ddelta.js — d-deltanetからリアルタイム出玉情報を取得し、高設定推測を行うモジュール
 * 
 * 方針: 人間の操作を忠実に再現する「クリックスルー方式」
 *   ポータル → 機種クリック → 「大当り一覧」クリック → データ読む → 「戻る」で機種ページ → 「戻る」でポータル → 次の機種
 *   page.goto()はセッション確立の初回のみ使用
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { loadDB, getDefaultSpecs } = require('./machine_lookup');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));

const PORTAL_URL = 'https://www.d-deltanet.com/pc/D0301.do?pmc=22021030&clc=03&urt=2173&pan=1';

/** ランダムな待機時間（人間っぽさ） */
function humanDelay(min = 800, max = 2000) {
    const ms = Math.floor(Math.random() * (max - min)) + min;
    return new Promise(r => setTimeout(r, ms));
}

/** Cookie同意バナーの処理 */
async function handleCookieConsent(page) {
    try {
        const agreeBtn = await page.$('.agree button');
        if (agreeBtn) {
            console.log('[DDelta] Cookie同意ボタンをクリック');
            await agreeBtn.click();
            await humanDelay(1000, 2000);
        }
    } catch (e) {}
}

/** エラーページかどうかチェック */
async function isErrorPage(page) {
    try {
        return await page.evaluate(() => {
            const title = document.title || '';
            const body = document.body ? document.body.innerText : '';
            return title.includes('エラー') || body.includes('混み合っております');
        });
    } catch (e) {
        return false;
    }
}

/** エラーなら「戻る」を使ってリトライ */
async function retryOnError(page, label, retries = 3) {
    for (let i = 0; i < retries; i++) {
        if (!(await isErrorPage(page))) return true;
        console.log(`[DDelta] ⚠️ ${label} エラー検出 (${i+1}/${retries}) - 待機して再読み込み...`);
        await humanDelay(3000 + i * 2000, 5000 + i * 2000);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
        await humanDelay(1500, 3000);
    }
    return !(await isErrorPage(page));
}

/** ページ上の「戻る」リンクをクリック */
async function clickBackLink(page) {
    const backLink = await page.evaluateHandle(() => {
        const links = Array.from(document.querySelectorAll('a'));
        // footerの「戻る」リンクを探す
        return links.find(a => {
            const text = a.innerText.trim();
            return text === '戻る' || text.endsWith('戻る');
        });
    });
    
    if (backLink && backLink.asElement()) {
        await backLink.asElement().click();
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });
        await humanDelay(500, 1500);
        return true;
    }
    return false;
}

/**
 * メイン: puppeteerでd-deltanetから全機種のリアルタイムデータを取得
 */
async function scrapeDDelta(onProgress) {
    console.log('[DDelta] ブラウザを起動し、リアルタイムデータの取得を開始します...');
    const launchOpts = {
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process', '--window-size=1280,1080']
    };
    // Render等: システムのChromiumを使う場合
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        console.log(`[DDelta] executablePath: ${launchOpts.executablePath}`);
    }
    const browser = await puppeteer.launch(launchOpts);
    
    const results = [];
    
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        // ===== STEP 1: ポータルページにアクセス（セッション確立） =====
        console.log('[DDelta] ポータルページへアクセス...');
        await page.goto(PORTAL_URL, { waitUntil: 'networkidle2', timeout: 60000 });
        await handleCookieConsent(page);
        
        if (await isErrorPage(page)) {
            if (!(await retryOnError(page, 'ポータル', 3))) {
                console.error('[DDelta] ❌ ポータルに接続できません。');
                return [];
            }
        }
        
        // ===== STEP 2: 全ページの機種リストを収集 =====
        // 現在のページ（ポータル）の機種名を取得し、「次へ」で全ページ巡回
        const allModelNames = [];
        let portalPageNum = 1;
        
        while (true) {
            const pageNames = await page.evaluate(() => {
                const names = [];
                document.querySelectorAll('#model_link ul a').forEach(a => {
                    let text = a.innerText.replace(/\n/g, '').trim().replace(/\[\d+\]$/, '').trim();
                    if (text && text.length > 1 && !text.includes('すべて')) {
                        names.push(text);
                    }
                });
                return names;
            });
            
            console.log(`[DDelta] ポータル ページ${portalPageNum}: ${pageNames.length} 機種`);
            allModelNames.push(...pageNames);
            
            // 「次へ」リンクがあればクリック
            const nextLink = await page.evaluateHandle(() => {
                const links = Array.from(document.querySelectorAll('.list_navigation a, a'));
                return links.find(a => a.innerText.includes('次へ'));
            });
            
            if (nextLink && nextLink.asElement()) {
                portalPageNum++;
                await nextLink.asElement().click();
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });
                await humanDelay(1000, 2000);
                if (await isErrorPage(page)) {
                    if (!(await retryOnError(page, `ポータルP${portalPageNum}`, 2))) break;
                }
            } else {
                break; // 最後のページ
            }
        }
        
        console.log(`[DDelta] 合計 ${allModelNames.length} 機種を発見。データ取得を開始...\n`);
        
        // ポータルのページ1に戻る（「前へ」をクリックするか、最初の1回だけgoto）
        if (portalPageNum > 1) {
            await page.goto(PORTAL_URL, { waitUntil: 'networkidle2', timeout: 30000 });
            await humanDelay(500, 1000);
            await handleCookieConsent(page);
        }
        
        // ===== STEP 3: 各機種を人間のように順番に巡回 =====
        // 方針: ポータルの各ページで、上から順にクリックして巡回
        //       1つの機種が終わったら「戻る」×2でポータルに戻り、次の機種をクリック
        let currentPortalPage = 1;
        let processedOnThisPage = 0;
        
        for (let i = 0; i < allModelNames.length; i++) {
            const modelName = allModelNames[i];
            console.log(`[DDelta] (${i+1}/${allModelNames.length}) 「${modelName}」`);
            if (onProgress) onProgress(i + 1, allModelNames.length, modelName);
            
            try {
                // 現在のポータルページで機種リンクを探す
                let modelLink = await page.evaluateHandle((name) => {
                    const links = Array.from(document.querySelectorAll('#model_link ul a, a[href*="D2301"]'));
                    return links.find(a => {
                        const text = a.innerText.replace(/\n/g, '').trim();
                        return text.includes(name);
                    });
                }, modelName);
                
                // 見つからなければ「次へ」で次のポータルページに移動
                if (!modelLink || !modelLink.asElement()) {
                    const nextLink = await page.evaluateHandle(() => {
                        const links = Array.from(document.querySelectorAll('a'));
                        return links.find(a => a.innerText.includes('次へ'));
                    });
                    if (nextLink && nextLink.asElement()) {
                        currentPortalPage++;
                        processedOnThisPage = 0;
                        console.log(`[DDelta]   → ポータル次ページ(P${currentPortalPage})へ移動`);
                        await nextLink.asElement().click();
                        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });
                        await humanDelay(1000, 2000);
                        if (await isErrorPage(page)) {
                            if (!(await retryOnError(page, `ポータルP${currentPortalPage}`, 2))) break;
                        }
                        
                        // 再度探す
                        modelLink = await page.evaluateHandle((name) => {
                            const links = Array.from(document.querySelectorAll('#model_link ul a, a[href*="D2301"]'));
                            return links.find(a => {
                                const text = a.innerText.replace(/\n/g, '').trim();
                                return text.includes(name);
                            });
                        }, modelName);
                    }
                }
                
                if (!modelLink || !modelLink.asElement()) {
                    console.log(`[DDelta]   ⚠️ リンクが見つかりません。スキップ。`);
                    continue;
                }
                
                // ===== 機種リンクをクリック =====
                await humanDelay(500, 1200);
                await modelLink.asElement().click();
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });
                await humanDelay(800, 1500);
                
                if (await isErrorPage(page)) {
                    if (!(await retryOnError(page, `${modelName} 機種ページ`, 2))) {
                        console.log(`[DDelta]   ⚠️ 機種ページ取得失敗。スキップ。`);
                        // 戻れるなら戻る
                        await clickBackLink(page) || await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
                        await humanDelay(500, 1000);
                        continue;
                    }
                }
                
                // ===== 「大当り一覧」をクリック =====
                const dataListLink = await page.evaluateHandle(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    return links.find(a => a.innerText.includes('大当り一覧'));
                });

                if (!dataListLink || !dataListLink.asElement()) {
                    console.log(`[DDelta]   ⚠️ 「大当り一覧」リンクなし。戻ります。`);
                    await clickBackLink(page);
                    continue;
                }
                
                await humanDelay(400, 1000);
                await dataListLink.asElement().click();
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });
                await humanDelay(1000, 2000);
                
                // エラーリトライ
                if (!(await retryOnError(page, `${modelName} 大当り一覧`, 3))) {
                    console.log(`[DDelta]   ⚠️ 大当り一覧取得失敗。戻ります。`);
                    // 戻る×2
                    await clickBackLink(page);
                    await clickBackLink(page);
                    continue;
                }
                
                // ===== テーブルからデータ抽出 =====
                // 重要: d-deltanetのテーブルはヘッダーに<th>ではなく<td class="table_head">を使用
                const currentData = await page.evaluate((name) => {
                    const rowsData = [];
                    let hasParsedHeaders = false;
                    let colIdx = { 台番: -1, G数: -1, BB: -1, RB: -1, ART: -1 };

                    document.querySelectorAll('table tr').forEach(tr => {
                        const tds = Array.from(tr.querySelectorAll('td'));
                        const cellTexts = tds.map(td => td.innerText.trim());
                        
                        // ヘッダー行の検出: td.table_headクラスまたはthタグ
                        const isHeaderRow = tds.some(td => td.classList.contains('table_head')) ||
                                           tr.querySelectorAll('th').length > 0;
                        
                        if (isHeaderRow && !hasParsedHeaders) {
                            // ヘッダー行: th or td.table_head のテキストから列インデックスを取得
                            const headerTexts = tds.length > 0 ? cellTexts : 
                                Array.from(tr.querySelectorAll('th')).map(th => th.innerText.trim());
                            headerTexts.forEach((h, idx) => {
                                if (h.includes('台番')) colIdx.台番 = idx;
                                else if (h.includes('累計G') || h.includes('累計ゲーム') || h.includes('ゲーム')) colIdx.G数 = idx;
                                else if (h.includes('BB')) colIdx.BB = idx;
                                else if (h.includes('RB')) colIdx.RB = idx;
                                else if (h.includes('ART')) colIdx.ART = idx;
                            });
                            hasParsedHeaders = true;
                            return;
                        }
                        
                        // データ行: table_footクラス（平均行など）を除外
                        const isFooterRow = tds.some(td => td.classList.contains('table_foot'));
                        
                        if (!isFooterRow && cellTexts.length >= 2 && colIdx.台番 !== -1 && colIdx.G数 !== -1) {
                            const 台番 = parseInt(cellTexts[colIdx.台番]);
                            const G数 = parseInt(cellTexts[colIdx.G数]);
                            if (!isNaN(台番) && !isNaN(G数)) {
                                rowsData.push({
                                    機種名: name, 台番, G数,
                                    BB回数: colIdx.BB !== -1 ? (parseInt(cellTexts[colIdx.BB]) || 0) : 0,
                                    RB回数: colIdx.RB !== -1 ? (parseInt(cellTexts[colIdx.RB]) || 0) : 0,
                                    ART回数: colIdx.ART !== -1 ? (parseInt(cellTexts[colIdx.ART]) || 0) : 0
                                });
                            }
                        }
                    });
                    return rowsData;
                }, modelName);

                if (currentData.length > 0) {
                    console.log(`[DDelta]   ⭕ ${currentData.length} 台取得`);
                    results.push(...currentData);
                } else {
                    console.log(`[DDelta]   ⚠️ データ0件`);
                }
                
                // ===== 「戻る」×2 でポータルに戻る =====
                // 大当り一覧 → 機種トップ → ポータル (人間の操作を再現)
                await humanDelay(500, 1200);
                
                // 戻る1回目: 大当り一覧 → 機種トップ
                if (!(await clickBackLink(page))) {
                    // フォールバック: ブラウザの「戻る」
                    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
                    await humanDelay(500, 1000);
                }
                
                // 戻る2回目: 機種トップ → ポータル
                if (!(await clickBackLink(page))) {
                    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
                    await humanDelay(500, 1000);
                }
                
                processedOnThisPage++;
                
            } catch (innerErr) {
                console.log(`[DDelta]   ⚠️ エラー: ${innerErr.message}`);
                // エラー時はポータルに確実に戻す
                try {
                    await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
                    await humanDelay(1000, 2000);
                    await handleCookieConsent(page);
                } catch(e) {}
            }
            
            // 機種間のインターバル（人間っぽく）
            await humanDelay(800, 2000);
        }
        
    } catch (error) {
        console.error('[DDelta] 致命的エラー:', error);
    } finally {
        await browser.close();
    }

    console.log(`\n[DDelta] 合計 ${results.length} 台の生データを取得。分析開始...`);
    return analyzeRealtimeData(results);
}

// ========================================
// 設定推測ロジック
// ========================================

function getProbThresholds(modelName) {
    if (modelName.includes('ジャグラー')) return { s6: 120, s5: 127, s4: 135, type: 'A' };
    if (modelName.includes('ハナハナ')) return { s6: 135, s5: 144, s4: 153, type: 'A' };
    if (modelName.includes('北斗の拳')) return { s6: 235, s5: 250, s4: 280, type: 'AT' }; 
    if (modelName.includes('ヴァルヴレイヴ')) return { s6: 250, s5: 270, s4: 290, type: 'AT' };
    if (modelName.includes('モンキーターン')) return { s6: 220, s5: 240, s4: 255, type: 'AT' };
    if (modelName.includes('カバネリ')) return { s6: 190, s5: 210, s4: 230, type: 'AT' };
    if (modelName.includes('沖ドキ')) return { s6: 230, s5: 250, s4: 280, type: 'AT' };
    if (modelName.includes('炎炎ノ消防隊')) return { s6: 200, s5: 215, s4: 230, type: 'AT' };
    if (modelName.includes('からくりサーカス')) return { s6: 250, s5: 270, s4: 290, type: 'AT' };
    return { s6: 220, s5: 240, s4: 260, type: 'AT' };
}

function analyzeRealtimeData(machines) {
    const db = loadDB();
    const asOfTime = new Date();
    const highSettingMachines = [];

    for (const m of machines) {
        if (m.G数 < 1) continue;
        const specs = db[m.機種名] || getDefaultSpecs();
        const thresholds = getProbThresholds(m.機種名);
        const totalHits = m.BB回数 + m.RB回数 + m.ART回数;
        
        if (totalHits === 0) {
            m.実質確率 = '-'; m.推定設定 = 0; m.信頼度スコア = 0; m.信頼度ラベル = '-';
            m.残りG数 = 0; m.期待差枚 = 0; m.期待値円 = 0;
            highSettingMachines.push(m);
            continue;
        }

        const actualProb = m.G数 / totalHits;
        m.実質確率 = `1/${actualProb.toFixed(1)}`;

        let estimatedSetting = 1;
        if (actualProb <= thresholds.s6) estimatedSetting = 6;
        else if (actualProb <= thresholds.s5) estimatedSetting = 5;
        else if (actualProb <= thresholds.s4) estimatedSetting = 4;
        else estimatedSetting = m.G数 >= 1000 ? 2 : 0;
        m.推定設定 = estimatedSetting;

        let confidence = 10;
        if (m.G数 >= 5000) confidence = 85;
        else if (m.G数 >= 3000) confidence = 50;
        else if (m.G数 >= 1000) confidence = 30;
        m.信頼度スコア = confidence;
        m.信頼度ラベル = confidence >= 80 ? '★★★ 高' : (confidence >= 50 ? '★★☆ 中' : '★☆☆ 低');
        
        const closingTime = new Date(asOfTime);
        closingTime.setHours(config.closingTime.hour, config.closingTime.minute, 0, 0);
        const remainingSec = (closingTime - asOfTime) / 1000;
        
        if (remainingSec > 0) {
            const 残りG数 = Math.floor(remainingSec / config.analysis.secondsPerGame);
            const theoreticalRate = specs[`s${estimatedSetting}`] || 108.0;
            const 期待差枚 = Math.round(残りG数 * config.analysis.inPerGame * (theoreticalRate - 100) / 100);
            const 期待値円 = Math.round(期待差枚 * (config.analysis.coinRate / config.analysis.inPerGame));
            m.残りG数 = 残りG数; m.期待差枚 = 期待差枚; m.期待値円 = 期待値円; m.理論出率 = theoreticalRate;
        } else {
            m.残りG数 = 0; m.期待差枚 = 0; m.期待値円 = 0;
        }
        highSettingMachines.push(m);
    }
    
    highSettingMachines.sort((a, b) => b.期待値円 - a.期待値円);
    return highSettingMachines;
}

if (require.main === module) {
    (async () => {
        const results = await scrapeDDelta();
        console.log(`\n=== リアルタイム抽出結果 (全${results.length}台) ===`);
        const high = results.filter(m => m.推定設定 >= 5);
        console.log(`設定5以上: ${high.length}台`);
        console.log(JSON.stringify(high.slice(0, 10), null, 2));
    })();
}

module.exports = { scrapeDDelta, analyzeRealtimeData };
