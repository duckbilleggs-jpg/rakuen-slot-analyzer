/**
 * scraper_ddelta.js — d-deltanetからリアルタイム出玉情報を取得し、高設定推測を行うモジュール
 * 
 * HTTP GET方式: Puppeteer不要。PADプロジェクトと同じアプローチ。
 *   URLアクセスでHTML取得(Shift_JIS) → 正規表現で解析 → 高速・安定
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { loadDB, getDefaultSpecs } = require('./machine_lookup');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));

const BASE_URL = 'https://www.d-deltanet.com/pc';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** セッションCookie管理 + 最終URL(Referer用) */
let sessionCookies = '';
let lastAccessUrl = '';

/** HTTP GETでHTMLを取得（Shift_JIS+Cookie+Referer対応） */
function fetchHTML(urlPath) {
    const fullUrl = urlPath.startsWith('http') ? urlPath : `${BASE_URL}/${urlPath}`;
    return new Promise((resolve, reject) => {
        const doRequest = (url, redirectCount = 0) => {
            if (redirectCount > 5) return reject(new Error('リダイレクト回数超過'));
            const headers = { 'User-Agent': USER_AGENT };
            if (sessionCookies) headers['Cookie'] = sessionCookies;
            if (lastAccessUrl) headers['Referer'] = lastAccessUrl;
            
            const req = https.get(url, { headers }, (res) => {
                // Set-Cookieを蓄積
                if (res.headers['set-cookie']) {
                    const cookieMap = {};
                    (sessionCookies ? sessionCookies.split('; ') : []).forEach(c => {
                        const [k] = c.split('='); cookieMap[k] = c;
                    });
                    res.headers['set-cookie'].forEach(c => {
                        const p = c.split(';')[0]; const [k] = p.split('='); cookieMap[k] = p;
                    });
                    sessionCookies = Object.values(cookieMap).join('; ');
                }
                // リダイレクト追跡
                if ([301, 302, 303, 307].includes(res.statusCode) && res.headers.location) {
                    const newUrl = res.headers.location.startsWith('http') 
                        ? res.headers.location : `${BASE_URL}/${res.headers.location}`;
                    return doRequest(newUrl, redirectCount + 1);
                }
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    const buf = Buffer.concat(chunks);
                    let html;
                    try {
                        const iconv = require('iconv-lite');
                        html = iconv.decode(buf, 'Shift_JIS');
                    } catch (e) {
                        html = buf.toString('latin1');
                    }
                    lastAccessUrl = url; // Referer用に保存
                    resolve(html);
                });
                res.on('error', reject);
            });
            req.on('error', reject);
            req.setTimeout(30000, () => { req.destroy(); reject(new Error('タイムアウト')); });
        };
        doRequest(fullUrl);
    });
}



/** sleep */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * ポータルページから全機種のリンク情報を取得
 * 返り値: [{name: '機種名', url: 'D2301.do?...'}]
 */
async function fetchModelList(storeConfig) {
    const allModels = [];
    let page = 1;
    const { pmc, clc, urt } = storeConfig.ddelta;
    
    while (true) {
        console.log(`[DDelta] ${storeConfig.name} ポータル ページ${page} を取得中...`);
        const html = await fetchHTML(`D0301.do?pmc=${pmc}&clc=${clc}&urt=${urt}&pan=${page}`);
        
        // デバッグ: HTML内容の確認
        const d2301Count = (html.match(/D2301/g) || []).length;
        console.log(`[DDelta] HTML長: ${html.length}文字, D2301出現: ${d2301Count}回, 先頭: ${html.substring(0, 100).replace(/\n/g, ' ')}`);
        
        // エラーページチェック
        if (html.includes('エラーページ') || html.includes('表示できません')) {
            console.log(`[DDelta] ⚠️ ポータル ページ${page} エラー。`);
            if (page === 1) {
                console.log('[DDelta] ❌ ポータルにアクセスできません。営業時間外の可能性があります。');
                return [];
            }
            break;
        }
        
        // 機種リンクを正規表現で抽出
        // 構造: <a href="D2301.do?...">...<li>...<div>...</div>機種名 [台数]</li>...</a>
        const modelPattern = /<a\s+href="(D2301\.do\?[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
        let match;
        let pageCount = 0;
        
        while ((match = modelPattern.exec(html)) !== null) {
            const url = match[1].replace(/&amp;/g, '&');
            // HTMLタグを除去してテキストだけ取得
            let rawText = match[2].replace(/<[^>]+>/g, '').trim();
            // 「機種名 [台数]」から台数部分を除去
            let name = rawText.replace(/\[\d+\]/, '').trim();
            // 複数空白を1つに
            name = name.replace(/\s+/g, ' ').trim();
            
            if (name && name.length > 1 && !name.includes('すべて')) {
                allModels.push({ name, url });
                pageCount++;
            }
        }
        
        console.log(`[DDelta] ページ${page}: ${pageCount} 機種`);
        
        // 次ページリンクがあるかチェック
        const nextPagePattern = `pan=${page + 1}`;
        if (!html.includes(nextPagePattern)) {
            break;
        }
        
        page++;
        await sleep(500); // サーバー負荷軽減
    }
    
    return allModels;
}

/**
 * 機種の大当たり一覧ページからテーブルデータを取得
 * 
 * 流れ: 機種ページ(D2301) → 大当たり一覧リンクのURL抽出 → そのページのテーブル解析
 */
async function fetchModelData(modelInfo) {
    const { name, url } = modelInfo;
    
    // Step 1: 機種ページを取得
    let html;
    try {
        html = await fetchHTML(url);
    } catch (e) {
        console.log(`[DDelta]   ⚠️ 機種ページ取得失敗: ${e.message}`);
        return [];
    }
    
    if (html.includes('エラーページ') || html.includes('表示できません')) {
        console.log(`[DDelta]   ⚠️ 機種ページエラー（データ表示不可）`);
        return [];
    }
    
    // Step 2: 「大当り一覧」リンクのURLを抽出
    // HTMLの&amp;を&に変換してからマッチ
    const decoded = html.replace(/&amp;/g, '&');
    // D3301.doリンクを探す（大当り一覧）
    const d3301Match = decoded.match(/href="(D3301\.do\?[^"]+)"/);
    // D2901.doリンクも探す（累計ゲーム等のフォールバック）  
    const d2901Match = decoded.match(/href="(D2901\.do\?[^"]+)"/);
    const dataListMatch = d3301Match || d2901Match;
    
    if (!dataListMatch) {
        console.log(`[DDelta]   ⚠️ データリンクなし。直接テーブルを試みます。`);
        return parseDataTable(html, name);
    }
    
    const dataListUrl = dataListMatch[1];
    
    // Step 3: 大当り一覧ページ(データ1)を取得（レートリミット対策で間隔を空ける）
    await sleep(1000);
    let dataHtml = await fetchWithRetry(dataListUrl);
    if (!dataHtml) return [];
    
    // Step 4: データ2のURLを探して取得（最高出玉等）
    let data2Url = null;
    const cheerio = require('cheerio');
    const $1 = cheerio.load(dataHtml);
    $1('a').each((i, el) => {
        const text = $1(el).text();
        if (text.includes('データ2') || text.includes('データ２') || text.includes('2')) {
            const href = $1(el).attr('href');
            if (href && href.includes('.do?')) {
                data2Url = href.replace(/&amp;/g, '&');
            }
        }
    });

    // dan=2 などのパターンで直接組み立てるフォールバック
    if (!data2Url && dataListUrl.includes('dan=')) {
        data2Url = dataListUrl.replace(/dan=\d+/, 'dan=2');
    }

    let data2Html = '';
    if (data2Url) {
        await sleep(1000);
        data2Html = await fetchWithRetry(data2Url);
    }
    
    console.log(`[DDelta]   ✅ データ取得 (Data1: ${dataHtml.length}文字, Data2: ${data2Html ? data2Html.length : 0}文字)`);
    return parseDataTable(dataHtml, data2Html, name);
}

/** 混雑エラー時のリトライ付きフェッチ */
async function fetchWithRetry(url) {
    let retries = 3;
    while (retries > 0) {
        let html;
        try {
            html = await fetchHTML(url);
        } catch (e) {
            console.log(`[DDelta]   ⚠️ 取得失敗: ${e.message}`);
            return null;
        }
        
        if (html.includes('エラーページ') || html.includes('混み合って')) {
            console.log(`[DDelta]   ⚠️ レートリミット。リトライ(3秒待機)... 残り${retries-1}回`);
            await sleep(3000);
            retries--;
        } else {
            return html;
        }
    }
    console.log(`[DDelta]   ❌ リトライ後もエラー`);
    return null;
}

/**
 * HTMLテーブルからデータを解析
 * Data1: 累計G数, BB, RB, ART など
 * Data2: 最高出玉(差枚) など
 */
function parseDataTable(html1, html2, modelName) {
    const rows = [];
    const cheerio = require('cheerio');
    
    // ヘッダー行: table_headクラスのtdからカラム名を特定
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

    if (colIdx1.台番 === -1 || colIdx1.G数 === -1) {
        return [];
    }

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
                最高出玉: 0 // デフォルト
            });
        }
    });

    // Data2 のパース（最高出玉）
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
                    const targetRow = rows.find(r => r.台番 === 台番);
                    if (targetRow && !isNaN(maxOut)) {
                        targetRow.最高出玉 = maxOut;
                    }
                }
            });
        }
    }
    
    return rows;
}

/**
 * メイン: HTTP GETでd-deltanetから全機種のリアルタイムデータを取得
 */
async function scrapeDDelta(onProgress, storeConfig = null) {
    if (!storeConfig) {
        storeConfig = config.stores.find(s => s.id === 'tachikawa');
    }
    console.log(`[DDelta] HTTP GET方式でリアルタイムデータの取得を開始します (${storeConfig.name})...`);
    
    // セッション初期化: トップページ→Cookieポリシー承諾
    sessionCookies = '';
    lastAccessUrl = '';
    console.log('[DDelta] セッション初期化中...');
    await fetchHTML('https://www.d-deltanet.com/');
    await fetchHTML(`${BASE_URL}/CommonSetCookie.do?key=cookie.policy.portal.agree&value=1678927575000`);
    console.log('[DDelta] Cookie承諾完了');
    
    const results = [];
    
    // Step 1: ポータルから全機種リスト取得
    const models = await fetchModelList(storeConfig);
    
    if (models.length === 0) {
        console.log('[DDelta] ❌ 機種リストが空です。');
        return [];
    }
    
    // 46円スロット機種名リストをファイルに保存（5円スロット除外用）
    const modelNames = [...new Set(models.map(m => m.name))].sort();
    try {
        const fs = require('fs');
        const path = require('path');
        fs.writeFileSync(path.join(__dirname, 'slot46_models.json'), JSON.stringify(modelNames, null, 2), 'utf8');
        console.log(`[DDelta] 46円スロット機種リスト保存: ${modelNames.length}機種`);
    } catch (e) {
        console.log(`[DDelta] 機種リストファイル保存スキップ（CI環境）: ${modelNames.length}機種`);
    }
    
    console.log(`[DDelta] 合計 ${models.length} 機種を発見。データ取得を開始...\n`);
    
    // Step 2: 各機種のデータを取得
    for (let i = 0; i < models.length; i++) {
        const model = models[i];
        console.log(`[DDelta] (${i+1}/${models.length}) 「${model.name}」`);
        if (onProgress) onProgress(i + 1, models.length, model.name);
        
        try {
            const data = await fetchModelData(model);
            if (data.length > 0) {
                console.log(`[DDelta]   ⭕ ${data.length} 台取得`);
                results.push(...data);
            } else {
                console.log(`[DDelta]   ⚠️ データ0件`);
            }
        } catch (err) {
            console.log(`[DDelta]   ⚠️ エラー: ${err.message}`);
        }
        
        // レートリミット対策: 1〜1.5秒の間隔
        await sleep(1000 + Math.floor(Math.random() * 500));
    }
    
    // 46円スロットの台番号リストを保存（5円スロット除外用ホワイトリスト）
    const slot46Numbers = [...new Set(results.map(m => m.台番))].sort((a, b) => a - b);
    try {
        fs.writeFileSync(path.join(__dirname, 'slot46_numbers.json'), JSON.stringify(slot46Numbers, null, 2), 'utf8');
        console.log(`[DDelta] 46円スロット台番号リスト保存: ${slot46Numbers.length}台`);
    } catch (e) {
        console.log(`[DDelta] 台番号リストファイル保存スキップ（CI環境）: ${slot46Numbers.length}台`);
    }
    
    console.log(`\n[DDelta] 合計 ${results.length} 台の生データを取得。分析開始...`);
    return analyzeRealtimeData(results);
}

// ========================================
// 設定推測ロジック（変更なし）
// ========================================

// 設定推測のハードコーディングは撤廃し、machine_db.jsonから読み込む形へ移行
function getDefaultThresholds() {
    return {
        probThresholds: { s6: 220, s5: 240, s4: 260 },
        hitCols: ['BB', 'RB', 'ART']
    };
}

function analyzeRealtimeData(machines) {
    const db = loadDB();
    const asOfTime = new Date();
    const highSettingMachines = [];

    for (const m of machines) {
        if (m.G数 < 1) {
            // 営業時間外（G数=0）でも台番データは保持
            m.実質確率 = '-'; m.推定設定 = 0; m.信頼度スコア = 0; m.信頼度ラベル = '-';
            m.残りG数 = 0; m.期待差枚 = 0; m.期待値円 = 0;
            highSettingMachines.push(m);
            continue;
        }
        const specs = db[m.機種名] || getDefaultSpecs();
        const thresholds = (db[m.機種名] && db[m.機種名].probThresholds) ? db[m.機種名].probThresholds : getDefaultThresholds().probThresholds;
        
        let totalHits = 0;
        const hitCols = (db[m.機種名] && db[m.機種名].hitCols) ? db[m.機種名].hitCols : getDefaultThresholds().hitCols;
        if (hitCols.includes('BB') || hitCols.includes('AT')) totalHits += m.BB回数; // データカウンタによりBB列にAT回数が入る場合も考慮
        if (hitCols.includes('RB')) totalHits += m.RB回数;
        if (hitCols.includes('ART')) totalHits += m.ART回数;

        // モンキーターン等、BBがないがARTに入っているケースのフェイルセーフ
        if (totalHits === 0 && (m.BB回数 + m.RB回数 + m.ART回数) > 0) {
            totalHits = m.BB回数 + m.RB回数 + m.ART回数;
        }
        
        if (totalHits === 0) {
            m.実質確率 = '-'; m.推定設定 = 0; m.信頼度スコア = 0; m.信頼度ラベル = '-';
            m.残りG数 = 0; m.期待差枚 = 0; m.期待値円 = 0;
            highSettingMachines.push(m);
            continue;
        }

        const actualProb = m.G数 / totalHits;
        const calcMethod = hitCols.join('+');
        m.実質確率 = `1/${actualProb.toFixed(1)}`;
        m.計算方式 = calcMethod;

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
        const args = process.argv.slice(2);
        let storeId = 'tachikawa';
        for (let i = 0; i < args.length; i++) {
            if (args[i] === '--store' && args[i+1]) storeId = args[++i];
        }
        const storeConfig = config.stores.find(s => s.id === storeId);
        if (!storeConfig) {
            console.error(`[Scraper] エラー: 指定された店舗ID '${storeId}' がconfig.jsonに見つかりません。`);
            process.exit(1);
        }

        const results = await scrapeDDelta(null, storeConfig);
        console.log(`\n=== リアルタイム抽出結果 (全${results.length}台 - ${storeConfig.name}) ===`);
        const high = results.filter(m => m.推定設定 >= 5);
        console.log(`設定5以上: ${high.length}台`);
        console.log(JSON.stringify(high.slice(0, 10), null, 2));
    })();
}

module.exports = { scrapeDDelta, analyzeRealtimeData };
