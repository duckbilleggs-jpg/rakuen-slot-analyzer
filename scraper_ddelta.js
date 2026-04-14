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
        
        
        // 混雑エラー時のリトライ付きでポータルページを取得
        let html = null;
        let retries = 3;
        while (retries > 0) {
            const fetched = await fetchHTML(`D0301.do?pmc=${pmc}&clc=${clc}&urt=${urt}&pan=${page}`);
            if (fetched.includes('混み合って') || fetched.includes('PNW500034')) {
                
                await sleep(3000);
                retries--;
            } else {
                html = fetched;
                break;
            }
        }
        if (!html) {
            
            if (page === 1) return [];
            break;
        }
        
        // デバッグ: HTML内容の確認
        const d2301Count = (html.match(/D2301/g) || []).length;
        
        
        // エラーページチェック
        if (html.includes('エラーページ') || html.includes('表示できません')) {
            
            if (page === 1) {
                
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
        
        return [];
    }
    
    if (html.includes('エラーページ') || html.includes('表示できません')) {
        
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
            
            return null;
        }
        
        if (html.includes('エラーページ') || html.includes('混み合って')) {
            
            await sleep(3000);
            retries--;
        } else {
            return html;
        }
    }
    
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
    
    
    // セッション初期化: トップページ→Cookieポリシー承諾
    sessionCookies = '';
    lastAccessUrl = '';
    
    await fetchHTML('https://www.d-deltanet.com/');
    await fetchHTML(`${BASE_URL}/CommonSetCookie.do?key=cookie.policy.portal.agree&value=1678927575000`);
    
    
    const results = [];
    
    // Step 1: ポータルから全機種リスト取得
    const models = await fetchModelList(storeConfig);
    
    if (models.length === 0) {
        
        return [];
    }
    
    // 46円スロット機種名リストをファイルに保存（5円スロット除外用）
    const modelNames = [...new Set(models.map(m => m.name))].sort();
    try {
        const fs = require('fs');
        const path = require('path');
        fs.writeFileSync(path.join(__dirname, 'slot46_models.json'), JSON.stringify(modelNames, null, 2), 'utf8');
        
    } catch (e) {
        
    }
    
    
    
    // Step 2: 各機種のデータを取得
    for (let i = 0; i < models.length; i++) {
        const model = models[i];
        try {
            const data = await fetchModelData(model);
            if (data.length > 0) {
                results.push(...data);
            }
        } catch (err) {
            // エラーは無視して次へ
        }
        
        // レートリミット対策: 1〜1.5秒の間隔
        await sleep(1000 + Math.floor(Math.random() * 500));
    }
    
    // 46円スロットの台番号リストを保存（5円スロット除外用ホワイトリスト）
    const slot46Numbers = [...new Set(results.map(m => m.台番))].sort((a, b) => a - b);
    try {
        fs.writeFileSync(path.join(__dirname, 'slot46_numbers.json'), JSON.stringify(slot46Numbers, null, 2), 'utf8');
        
    } catch (e) {
        
    }
    
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

/**
 * 多指標による信頼度スコア計算 (0〜99)
 * 
 * [Aタイプ]
 *   ① ゲーム数ベース (最大40pt)
 *   ② BB確率が推定設定の理論値内か (最大20pt)
 *   ③ RB確率も高設定帯か (最大20pt)
 *   ④ BB・RBが同設定帯で一致する（アライメントボーナス）(最大15pt)
 *
 * [AT機]
 *   ① ゲーム数ベース (最大40pt)
 *   ② 初当り確率のS6理論値からの近さ・良さ (最大30pt)
 *   ③ ヒット数の絶対量チェック（試行回数不足なら減点）(-15pt)
 */
function calcConfidenceScore(m, machineType, specs, thresholds, actualProb, estimatedSetting) {
    // ① ゲーム数ベース (最大40pt)
    let confidence = 10;
    if (m.G数 >= 6000) confidence = 40;
    else if (m.G数 >= 4000) confidence = 30;
    else if (m.G数 >= 2000) confidence = 20;

    if (estimatedSetting < 5) {
        // 低設定はゲーム数のみで評価、最大50pt
        return Math.min(confidence, 50);
    }

    if (machineType === 'A' || machineType === 'A+AT') {
        // ========== Aタイプ専用 ==========
        const bbHits = m.BB回数 || 0;
        const rbHits = m.RB回数 || 0;

        if (bbHits > 0 && rbHits > 0) {
            const bbProb = m.G数 / bbHits;
            const rbProb = m.G数 / rbHits;

            // ② BB確率が推定設定の閾値を満たすか
            const bbThr = thresholds[`s${estimatedSetting}`] || thresholds.s5 || 130;
            if (bbProb <= bbThr) confidence += 20;
            else if (bbProb <= bbThr * 1.05) confidence += 10; // 5%以内のブレは加点

            // ③ RB確率も高設定帯かチェック
            // RB閾値が未定義の場合はBB閾値の約2倍を目安に推定
            const rbThresholds = specs.rbProbThresholds || {
                s6: (thresholds.s6 || 120) * 2.1,
                s5: (thresholds.s5 || 130) * 2.1,
                s4: (thresholds.s4 || 140) * 2.1,
            };
            let rbEstSetting = 1;
            if (rbProb <= rbThresholds.s6) rbEstSetting = 6;
            else if (rbProb <= rbThresholds.s5) rbEstSetting = 5;
            else if (rbProb <= rbThresholds.s4) rbEstSetting = 4;

            if (rbEstSetting >= 5) confidence += 20;
            else if (rbEstSetting >= 4) confidence += 10;

            // ④ BBとRBで推定設定が一致するか（アライメントボーナス）
            if (Math.abs(rbEstSetting - estimatedSetting) <= 1) confidence += 15;
            
            // RBが全く引けていなければ信頼度を大きく割り引く
            if (rbHits === 0 && m.G数 >= 2000) confidence -= 20;
        }

    } else {
        // ========== AT機専用 ==========
        const s6Thr = thresholds.s6 || 220;
        const s5Thr = thresholds.s5 || 250;

        // ② S6理論値からのズレ量で加算（軽いほど≒良い）
        if (estimatedSetting >= 6) {
            const deviationPct = (s6Thr - actualProb) / s6Thr * 100; // 正なら理論値より良い
            if (deviationPct >= 10) confidence += 30;      // 10%以上 理論より良い → 超確実
            else if (deviationPct >= 5) confidence += 20;  // 5〜10%
            else if (deviationPct >= 0) confidence += 15;  // ちょうど S6境界
            else confidence += 5;                           // 理論より若干重い（誤差範囲内）
        } else if (estimatedSetting >= 5) {
            const rangeWidth = s5Thr - s6Thr;
            const withinRange = (actualProb - s6Thr) / rangeWidth; // S6=0, S5=1
            if (withinRange <= 0.3) confidence += 15;      // S6境界に近い
            else if (withinRange <= 0.6) confidence += 10;
            else confidence += 5;
        }

        // ③ 初当りの絶対数が少ない場合は減点（試行回数不足）
        const totalHitsForCheck = (m.BB回数 || 0) + (m.RB回数 || 0) + (m.ART回数 || 0);
        if (totalHitsForCheck < 10) confidence -= 15;
        else if (totalHitsForCheck < 20) confidence -= 5;
    }

    return Math.min(Math.max(confidence, 0), 99);
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
        const machineType = specs.type || 'AT';
        
        let totalHits = 0;
        let calcMethod = '';
        let thresholds;
        
        if (machineType === 'A' || machineType === 'A+AT') {
            // Aタイプ（ジャグラー等ネット機）: BB+RB合算
            totalHits = (m.BB回数 || 0) + (m.RB回数 || 0);
            calcMethod = 'BB+RB';
            thresholds = specs.probThresholds || getDefaultThresholds().probThresholds;
        } else {
            // AT機: machine_dbのhitColsに基づいて初当たりを計算
            const hitCols = specs.hitCols || ['BB', 'RB', 'ART'];
            
            for (const col of hitCols) {
                if (col === 'BB') totalHits += (m.BB回数 || 0);
                if (col === 'RB') totalHits += (m.RB回数 || 0);
                if (col === 'ART') totalHits += (m.ART回数 || 0);
            }
            calcMethod = hitCols.join('+');
            // AT機用の確率閾値
            thresholds = specs.probThresholds || { s6: 220, s5: 250, s4: 300 };
        }
        
        if (totalHits === 0) {
            m.実質確率 = '-'; m.推定設定 = 0; m.信頼度スコア = 0; m.信頼度ラベル = '-';
            m.残りG数 = 0; m.期待差枚 = 0; m.期待値円 = 0;
            highSettingMachines.push(m);
            continue;
        }

        const actualProb = m.G数 / totalHits;
        m.実質確率 = `1/${actualProb.toFixed(1)}`;
        m.計算方式 = calcMethod;

        let estimatedSetting = 1;
        if (m.G数 < (config.analysis ? config.analysis.minGames : 2000)) {
            estimatedSetting = 0;
        } else {
            if (actualProb <= thresholds.s6) estimatedSetting = 6;
            else if (actualProb <= thresholds.s5) estimatedSetting = 5;
            else if (actualProb <= thresholds.s4) estimatedSetting = 4;
            else estimatedSetting = m.G数 >= 1000 ? 2 : 0;
            
            // 【新規追加】AタイプのRB確率によるダウングレード判定
            if ((machineType === 'A' || machineType === 'A+AT') && estimatedSetting >= 5) {
                const rbHits = m.RB回数 || 0;
                if (rbHits > 0) {
                    const rbProb = m.G数 / rbHits;
                    // RBが設定1より重い(例:1/380より悪い)場合は設定4未満にダウン
                    if (rbProb > 380) {
                        estimatedSetting = 4;
                    }
                } else if (m.G数 >= 2000 && rbHits === 0) {
                    estimatedSetting = 2; // RBが全く引けていない
                }
            }
        }
        m.推定設定 = estimatedSetting;

        const confidence = calcConfidenceScore(m, machineType, specs, thresholds, actualProb, estimatedSetting);
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
            const 現在金額 = Math.round((m.最高出玉 || 0) * (1000 / 46));
            
            m.残りG数 = 残りG数; 
            m.現在金額 = 現在金額;
            m.期待差枚 = 期待差枚; 
            m.期待値円 = 期待値円; 
            m.理論出率 = theoreticalRate;
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
        
        const high = results.filter(m => m.推定設定 >= 5);
                
    })();
}

module.exports = { scrapeDDelta, analyzeRealtimeData };


