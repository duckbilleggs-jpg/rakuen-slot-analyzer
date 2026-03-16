/**
 * scraper_ddelta.js — d-deltanetからリアルタイム出玉情報を取得し、高設定推測を行うモジュール
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { loadDB, getDefaultSpecs } = require('./machine_lookup');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));

// 楽園立川のベースURL
const PORTAL_URL = 'https://www.d-deltanet.com/pc/D0301.do?pmc=22021030&clc=03&urt=2173&pan=1';

// 取得対象の機種リストは動的に取得するためハードコードを撤廃

/**
 * puppeteerを使ってd-deltanetから対象機種のリアルタイムデータを取得
 */
async function scrapeDDelta(onProgress) {
  console.log('[DDelta Scraper] ブラウザを起動し、リアルタイムデータの取得を開始します...');
  const browser = await puppeteer.launch({ 
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1280,1080']
  });
  
  const results = [];
  
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    
    // 1. トップページ（機種一覧ポータル）へアクセス
    console.log(`[DDelta Scraper] ポータルページへアクセス`);
    await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000)); // 動的コンテンツの読み込み待ち
    
    // Cookie同意
    try {
        const agreeBtn = await page.$('.agree button');
        if (agreeBtn) {
            await agreeBtn.click();
            await new Promise(r => setTimeout(r, 1000));
        }
    } catch (e) {}

    // #model_link要素の出現を待機
    try {
        await page.waitForSelector('#model_link', { timeout: 10000 });
    } catch (e) {
        console.log('[DDelta Scraper] ⚠️ #model_linkが見つかりませんでした');
    }

    // 2. ポータル画面から全機種のリンクを取得
    const modelLinks = await page.evaluate(() => {
        const links = [];
        // まず #model_link ul a を試す
        let aTags = document.querySelectorAll('#model_link ul a');
        // 見つからない場合は #model_link a
        if (aTags.length === 0) {
            aTags = document.querySelectorAll('#model_link a');
        }
        // それでもない場合はページ全体からD2301を含むリンクを探す
        if (aTags.length === 0) {
            aTags = document.querySelectorAll('a[href*="D2301"]');
        }
        aTags.forEach(a => {
            let text = a.innerText.replace(/\n/g, '').trim();
            text = text.replace(/\[\d+\]$/, '').trim(); 
            const href = a.getAttribute('href');
            if (text && text.length > 1 && href && !text.includes('すべて') && !text.includes('1000円')) {
                links.push({ name: text, url: href });
            }
        });
        return links;
    });

    console.log(`[DDelta Scraper] 合計 ${modelLinks.length} 機種を発見しました。全機種のデータ取得を開始します...`);

    // 3. 対象機種ごとに巡回
    for (let i = 0; i < modelLinks.length; i++) {
        const model = modelLinks[i];
        console.log(`[DDelta Scraper] (${i+1}/${modelLinks.length}) 機種「${model.name}」を探索中...`);
        if (onProgress) onProgress(i + 1, modelLinks.length, model.name);
        
        try {
            // その機種のトップページに直接飛ぶ
            const modelUrl = new URL(model.url, PORTAL_URL).href;
            await page.goto(modelUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await new Promise(r => setTimeout(r, 200));

            // 「大当り一覧」のリンクを探してクリック
            const dataListLink = await page.evaluateHandle(() => {
                const links = Array.from(document.querySelectorAll('a'));
                return links.find(a => a.innerText.includes('大当り一覧'));
            });

            if (dataListLink && dataListLink.asElement()) {
                await dataListLink.asElement().click();
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
                await new Promise(r => setTimeout(r, 500)); // テーブルの描画待ち
            } else {
                 console.log(`[DDelta Scraper] ⚠️ ${model.name} の「大当り一覧」が見つかりませんでした。スキップします。`);
                 continue;
            }
            
            // テーブルからデータ抽出 (BB/RB/ART全て)
            const currentData = await page.evaluate((name) => {
                const rowsData = [];
                // テーブルのヘッダーを解析して各列のインデックスを特定
                let hasParsedHeaders = false;
                let colIdx = { 台番: -1, G数: -1, BB: -1, RB: -1, ART: -1 };

                document.querySelectorAll('table tr').forEach(tr => {
                    const ths = Array.from(tr.querySelectorAll('th')).map(th => th.innerText.trim());
                    if (ths.length > 0 && !hasParsedHeaders) {
                        ths.forEach((th, idx) => {
                            if (th.includes('台番')) colIdx.台番 = idx;
                            else if (th.includes('累計G')) colIdx.G数 = idx;
                            else if (th.includes('BB')) colIdx.BB = idx;
                            else if (th.includes('RB')) colIdx.RB = idx;
                            else if (th.includes('ART')) colIdx.ART = idx;
                        });
                        hasParsedHeaders = true;
                        return;
                    }

                    const tds = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
                    if (tds.length >= 2 && colIdx.台番 !== -1 && colIdx.G数 !== -1) {
                         // 合計行などを除外するために数字変換できるかチェック
                         const 台番 = parseInt(tds[colIdx.台番]);
                         const G数 = parseInt(tds[colIdx.G数]);
                         if (!isNaN(台番) && !isNaN(G数)) {
                             rowsData.push({
                                 機種名: name,
                                 台番: 台番,
                                 G数: G数,
                                 BB回数: colIdx.BB !== -1 ? (parseInt(tds[colIdx.BB]) || 0) : 0,
                                 RB回数: colIdx.RB !== -1 ? (parseInt(tds[colIdx.RB]) || 0) : 0,
                                 ART回数: colIdx.ART !== -1 ? (parseInt(tds[colIdx.ART]) || 0) : 0
                             });
                         }
                    }
                });
                return rowsData;
            }, model.name);

            console.log(`[DDelta Scraper] ⭕ ${currentData.length} 台のデータを取得完了: ${model.name}`);
            results.push(...currentData);
            
        } catch (innerErr) {
            console.log(`[DDelta Scraper] ⚠️ ${model.name} 取得中にエラー: ${innerErr.message}`);
        }
    }
    
  } catch (error) {
    console.error('[DDelta Scraper] エラー発生:', error);
  } finally {
    await browser.close();
  }

  // 取得したデータを元に設定推測・期待値計算を行う
  return analyzeRealtimeData(results);
}

/**
 * 各機種の初当たり・合算確率の目安（確率分母）を返す
 * ※数値が小さいほど高設定（当たりやすい）
 */
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
    
    // デフォルトAT機（最近のスマスロの平均的な初当たり・合算確率の目安）
    return { s6: 220, s5: 240, s4: 260, type: 'AT' };
}

/**
 * リアルタイムデータ（当日途中）からの設定推論ロジック (B案: 合算確率ベース)
 */
function analyzeRealtimeData(machines) {
    const db = loadDB();
    const asOfTime = new Date();
    const highSettingMachines = [];

    for (const m of machines) {
        // ゲーム数が0の台はスキップ
        if (m.G数 < 1) continue;

        const specs = db[m.機種名] || getDefaultSpecs();
        const thresholds = getProbThresholds(m.機種名);
        
        // 取得したBB/RB/ARTの合計を「総当たり回数」として扱う
        const totalHits = m.BB回数 + m.RB回数 + m.ART回数;
        
        if (totalHits === 0) {
            // まだ当たりが出ていない台も一応含める
            m.実質確率 = '-';
            m.推定設定 = 0;
            m.信頼度スコア = 0;
            m.信頼度ラベル = '-';
            m.残りG数 = 0; m.期待差枚 = 0; m.期待値円 = 0;
            highSettingMachines.push(m);
            continue;
        }

        // 実質の合算確率（1/〇〇）
        const actualProb = m.G数 / totalHits;
        m.実質確率 = `1/${actualProb.toFixed(1)}`; // レポート用

        // 確率ベースでの推定設定（数値が「小さい」ほど高設定）
        let estimatedSetting = 1;
        if (actualProb <= thresholds.s6) {
            estimatedSetting = 6;
        } else if (actualProb <= thresholds.s5) {
            estimatedSetting = 5;
        } else if (actualProb <= thresholds.s4) {
            estimatedSetting = 4;
        } else {
            // 設定4の基準にも満たない
            estimatedSetting = m.G数 >= 1000 ? 2 : 0; // G数少ない場合は判定不能
        }

        m.推定設定 = estimatedSetting;

        // 信頼度 (ゲーム数依存)
        let confidence = 10;
        if (m.G数 >= 5000) confidence = 85;
        else if (m.G数 >= 3000) confidence = 50;
        else if (m.G数 >= 1000) confidence = 30;
        m.信頼度スコア = confidence;
        m.信頼度ラベル = confidence >= 80 ? '★★★ 高' : (confidence >= 50 ? '★★☆ 中' : '★☆☆ 低');
        
        // 期待値計算 (閉店までの残りG数に応じた期待差枚)
        const closingTime = new Date(asOfTime);
        closingTime.setHours(config.closingTime.hour, config.closingTime.minute, 0, 0);
        const remainingSec = (closingTime - asOfTime) / 1000;
        
        if (remainingSec > 0) {
            const 残りG数 = Math.floor(remainingSec / config.analysis.secondsPerGame);
            // 期待値計算は引き続きDBの「理論出率（機械割）」を使用
            const theoreticalRate = specs[`s${estimatedSetting}`] || 108.0;
            const 期待差枚 = Math.round(残りG数 * config.analysis.inPerGame * (theoreticalRate - 100) / 100);
            const 期待値円 = Math.round(期待差枚 * (config.analysis.coinRate / config.analysis.inPerGame));
            
            m.残りG数 = 残りG数;
            m.期待差枚 = 期待差枚;
            m.期待値円 = 期待値円;
            m.理論出率 = theoreticalRate;
        } else {
            m.残りG数 = 0; m.期待差枚 = 0; m.期待値円 = 0;
        }

        highSettingMachines.push(m);
    }
    
    // 期待値でソート（高い順）
    highSettingMachines.sort((a, b) => b.期待値円 - a.期待値円);

    return highSettingMachines;
}

// CLIテスト用
if (require.main === module) {
    (async () => {
        const results = await scrapeDDelta();
        console.log(`\n=== リアルタイム抽出結果 (全台: ${results.length}台) ===`);
        console.log(JSON.stringify(results.slice(0, 10), null, 2));
    })();
}

module.exports = { scrapeDDelta, analyzeRealtimeData };
