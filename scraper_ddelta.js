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
const PORTAL_PATH = '/D0301.do?pmc=22021030&clc=03&urt=2173&pan=';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** HTTP GETでHTMLを取得（Shift_JISデコード対応） */
function fetchHTML(urlPath) {
    const fullUrl = urlPath.startsWith('http') ? urlPath : `${BASE_URL}/${urlPath}`;
    return new Promise((resolve, reject) => {
        const doRequest = (url, redirectCount = 0) => {
            if (redirectCount > 5) return reject(new Error('リダイレクト回数超過'));
            const req = https.get(url, {
                headers: { 'User-Agent': USER_AGENT }
            }, (res) => {
                // リダイレクト追跡
                if ([301, 302, 303, 307].includes(res.statusCode) && res.headers.location) {
                    const newUrl = res.headers.location.startsWith('http') 
                        ? res.headers.location 
                        : `${BASE_URL}/${res.headers.location}`;
                    console.log(`[DDelta] リダイレクト: ${res.statusCode} → ${newUrl}`);
                    return doRequest(newUrl, redirectCount + 1);
                }
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    const buf = Buffer.concat(chunks);
                    console.log(`[DDelta] HTTP ${res.statusCode} | ${buf.length} bytes | ${url.substring(0, 80)}`);
                    let html;
                    try {
                        const iconv = require('iconv-lite');
                        html = iconv.decode(buf, 'Shift_JIS');
                    } catch (e) {
                        html = buf.toString('latin1');
                        console.log('[DDelta] iconv-lite使用不可、latin1フォールバック');
                    }
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
async function fetchModelList() {
    const allModels = [];
    let page = 1;
    
    while (true) {
        console.log(`[DDelta] ポータル ページ${page} を取得中...`);
        const html = await fetchHTML(`D0301.do?pmc=22021030&clc=03&urt=2173&pan=${page}`);
        
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
    const dataListMatch = html.match(/href="([^"]*)"[^>]*>[^<]*大当り一覧/);
    if (!dataListMatch) {
        // 大当たり一覧がない場合、現在のページにテーブルがあるかもしれない
        console.log(`[DDelta]   ⚠️ 大当り一覧リンクなし。直接テーブルを試みます。`);
        return parseDataTable(html, name);
    }
    
    const dataListUrl = dataListMatch[1].replace(/&amp;/g, '&');
    
    // Step 3: 大当り一覧ページを取得
    await sleep(300);
    let dataHtml;
    try {
        dataHtml = await fetchHTML(dataListUrl);
    } catch (e) {
        console.log(`[DDelta]   ⚠️ 大当り一覧取得失敗: ${e.message}`);
        return [];
    }
    
    if (dataHtml.includes('エラーページ') || dataHtml.includes('表示できません')) {
        console.log(`[DDelta]   ⚠️ 大当り一覧エラー`);
        return [];
    }
    
    return parseDataTable(dataHtml, name);
}

/**
 * HTMLテーブルからデータを解析
 * d-deltanetのテーブル構造:
 *   <td class="table_head">台番</td><td class="table_head">累計G数</td>...
 *   <td>3501</td><td>5432</td>...
 */
function parseDataTable(html, modelName) {
    const rows = [];
    
    // テーブルを正規表現で解析
    // ヘッダー行: table_headクラスのtdからカラム名を特定
    const headerMatch = html.match(/<tr[^>]*>(\s*<td[^>]*class="table_head"[^>]*>[^<]*<\/td>\s*)+<\/tr>/);
    
    let colIdx = { 台番: -1, G数: -1, BB: -1, RB: -1, ART: -1 };
    
    if (headerMatch) {
        const headerRow = headerMatch[0];
        const headerCells = [...headerRow.matchAll(/<td[^>]*>([^<]*)<\/td>/g)];
        headerCells.forEach((cell, idx) => {
            const text = cell[1].trim();
            if (text.includes('台番')) colIdx.台番 = idx;
            else if (text.includes('累計G') || text.includes('累計ゲーム') || text.includes('ゲーム')) colIdx.G数 = idx;
            else if (text.includes('BB')) colIdx.BB = idx;
            else if (text.includes('RB')) colIdx.RB = idx;
            else if (text.includes('ART')) colIdx.ART = idx;
        });
    }
    
    if (colIdx.台番 === -1 || colIdx.G数 === -1) {
        return [];
    }
    
    // データ行を抽出: table_headでもtable_footでもない通常のtr
    const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let trMatch;
    
    while ((trMatch = trPattern.exec(html)) !== null) {
        const trContent = trMatch[1];
        
        // ヘッダー行・フッター行をスキップ
        if (trContent.includes('table_head') || trContent.includes('table_foot')) continue;
        
        // tdを抽出
        const tdCells = [...trContent.matchAll(/<td[^>]*>([^<]*)<\/td>/g)];
        if (tdCells.length < 2) continue;
        
        const cellTexts = tdCells.map(c => c[1].trim());
        
        const 台番 = parseInt(cellTexts[colIdx.台番]);
        const G数 = parseInt(cellTexts[colIdx.G数]);
        
        if (!isNaN(台番) && !isNaN(G数)) {
            rows.push({
                機種名: modelName,
                台番,
                G数,
                BB回数: colIdx.BB !== -1 ? (parseInt(cellTexts[colIdx.BB]) || 0) : 0,
                RB回数: colIdx.RB !== -1 ? (parseInt(cellTexts[colIdx.RB]) || 0) : 0,
                ART回数: colIdx.ART !== -1 ? (parseInt(cellTexts[colIdx.ART]) || 0) : 0
            });
        }
    }
    
    return rows;
}

/**
 * メイン: HTTP GETでd-deltanetから全機種のリアルタイムデータを取得
 */
async function scrapeDDelta(onProgress) {
    console.log('[DDelta] HTTP GET方式でリアルタイムデータの取得を開始します...');
    
    const results = [];
    
    // Step 1: ポータルから全機種リスト取得
    const models = await fetchModelList();
    
    if (models.length === 0) {
        console.log('[DDelta] ❌ 機種リストが空です。営業時間外の可能性があります。');
        return [];
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
        
        // サーバー負荷軽減（500ms〜1s間隔）
        await sleep(500 + Math.floor(Math.random() * 500));
    }
    
    console.log(`\n[DDelta] 合計 ${results.length} 台の生データを取得。分析開始...`);
    return analyzeRealtimeData(results);
}

// ========================================
// 設定推測ロジック（変更なし）
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
