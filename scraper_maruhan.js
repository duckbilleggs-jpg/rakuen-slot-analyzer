/**
 * scraper_maruhan.js — マルハンアプリのAPIからリアルタイム出玉情報を取得するモジュール
 * 
 * Phase 1: API解析で判明したエンドポイントを直接叩く方式
 * Phase 2: 設定推測ロジック（既存の analyzeRealtimeData を流用）
 * 
 * 使い方:
 *   node scraper_maruhan.js --store maruhan_kawaguchi
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));

// ============================================================
// API設定 — mitmproxyで解析した結果をここに記入
// ============================================================
// scripts/setup_maruhan_capture.ps1 → mitmweb でAPI通信をキャプチャ後、
// 以下のAPI_CONFIGを埋めてください。
//
// 確認するポイント:
//   1. エンドポイントURL（例: https://api.maruhan.co.jp/v1/hall/2627/machines）
//   2. ヘッダー（Authorization, User-Agent, X-App-Version 等）
//   3. レスポンスJSONの構造
// ============================================================
const API_CONFIG = {
    // --- API解析後にここを埋める ---
    baseUrl: '',          // 例: 'https://api.maruhan.co.jp'
    endpoints: {
        machineList: '',  // 例: '/v1/hall/{hallId}/machines'
        machineData: '',  // 例: '/v1/hall/{hallId}/machines/{machineId}/data'
    },
    headers: {
        // mitmproxyで確認したリクエストヘッダーをここにコピー
        // 'Authorization': 'Bearer xxx',
        // 'User-Agent': 'MaruhanApp/x.x.x',
        // 'X-App-Version': 'x.x.x',
    },
    // レスポンスJSONのフィールドマッピング
    fieldMapping: {
        machineNumber: '',  // 台番号のフィールド名
        modelName: '',      // 機種名のフィールド名
        totalGames: '',     // 累計ゲーム数のフィールド名
        bbCount: '',        // BB回数のフィールド名
        rbCount: '',        // RB回数のフィールド名
        artCount: '',       // ART回数のフィールド名
    }
};

/** API設定が完了しているかチェック */
function isApiConfigured() {
    return API_CONFIG.baseUrl && API_CONFIG.baseUrl.length > 0;
}

/** HTTP(S) GETリクエスト */
function apiGet(urlPath) {
    const fullUrl = urlPath.startsWith('http') ? urlPath : `${API_CONFIG.baseUrl}${urlPath}`;
    return new Promise((resolve, reject) => {
        const urlObj = new URL(fullUrl);
        const engine = urlObj.protocol === 'https:' ? https : http;
        
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                ...API_CONFIG.headers,
                'Accept': 'application/json',
            },
            timeout: 30000
        };
        
        const req = engine.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        resolve(body); // JSON以外のレスポンス
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`));
                }
            });
        });
        
        req.on('timeout', () => { req.destroy(); reject(new Error('APIタイムアウト (30秒)')); });
        req.on('error', reject);
        req.end();
    });
}

/** sleep */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * マルハンAPIからリアルタイムデータを取得
 * @param {Function} onProgress 進捗コールバック
 * @param {Object} storeConfig config.jsonの店舗設定
 */
async function scrapeMaruhan(onProgress, storeConfig) {
    if (!isApiConfigured()) {
        console.error('[Maruhan] ❌ API設定が未完了です。');
        console.error('[Maruhan] まず scripts/setup_maruhan_capture.ps1 を実行して');
        console.error('[Maruhan] mitmweb でAPI通信を解析し、API_CONFIG を埋めてください。');
        console.error('[Maruhan] 詳細手順: NOTES_マルハンAPI解析ガイド.md を参照');
        return [];
    }

    const hallId = storeConfig.maruhanHallId;
    console.log(`[Maruhan] リアルタイムデータ取得開始 (${storeConfig.name}, hallId: ${hallId})...`);

    try {
        // Step 1: 機種リスト取得
        const listUrl = API_CONFIG.endpoints.machineList.replace('{hallId}', hallId);
        console.log(`[Maruhan] 機種リスト取得: ${listUrl}`);
        const machineList = await apiGet(listUrl);
        
        const results = [];
        const fm = API_CONFIG.fieldMapping;
        
        // Step 2: レスポンスからデータを抽出
        // ※ 実際のAPIレスポンス構造に合わせて要調整
        const machines = Array.isArray(machineList) ? machineList : (machineList.data || machineList.machines || []);
        
        console.log(`[Maruhan] ${machines.length} 台のデータを取得`);
        
        for (let i = 0; i < machines.length; i++) {
            const m = machines[i];
            if (onProgress && i % 50 === 0) {
                onProgress(i + 1, machines.length);
            }
            
            results.push({
                機種名: m[fm.modelName] || m.model_name || m.modelName || '不明',
                台番: parseInt(m[fm.machineNumber] || m.machine_number || m.machineNumber || 0),
                G数: parseInt(m[fm.totalGames] || m.total_games || m.totalGames || 0),
                BB回数: parseInt(m[fm.bbCount] || m.bb_count || m.bbCount || 0),
                RB回数: parseInt(m[fm.rbCount] || m.rb_count || m.rbCount || 0),
                ART回数: parseInt(m[fm.artCount] || m.art_count || m.artCount || 0),
                最高出玉: parseInt(m.max_payout || m.maxPayout || 0),
            });
        }
        
        console.log(`[Maruhan] 合計 ${results.length} 台の生データを取得。分析開始...`);
        
        // 既存の設定推測ロジックを利用
        const { analyzeRealtimeData } = require('./scraper_ddelta');
        return analyzeRealtimeData(results);
        
    } catch (err) {
        console.error(`[Maruhan] エラー: ${err.message}`);
        return [];
    }
}

// ============================================================
// CLI実行
// ============================================================
if (require.main === module) {
    (async () => {
        const args = process.argv.slice(2);
        let storeId = 'maruhan_kawaguchi';
        for (let i = 0; i < args.length; i++) {
            if (args[i] === '--store' && args[i+1]) storeId = args[++i];
        }
        
        const storeConfig = config.stores.find(s => s.id === storeId);
        if (!storeConfig) {
            console.error(`[Maruhan] 店舗ID '${storeId}' が config.json にありません。`);
            
            // API_CONFIG未設定の場合はセットアップガイドを表示
            if (!isApiConfigured()) {
                console.log('\n==========================================');
                console.log(' マルハン API 設定ガイド');
                console.log('==========================================');
                console.log('');
                console.log('1. エミュレータ & mitmproxy セットアップ:');
                console.log('   .\\scripts\\setup_maruhan_capture.ps1');
                console.log('');
                console.log('2. エミュレータ上のマルハンアプリで台データを表示');
                console.log('');
                console.log('3. mitmweb (http://127.0.0.1:8081) でAPI通信を確認');
                console.log('');
                console.log('4. API情報を scraper_maruhan.js の API_CONFIG に記入');
                console.log('');
                console.log('※ SSL Pinningでブロックされる場合:');
                console.log('   .\\scripts\\bypass_ssl_pinning.ps1');
                console.log('==========================================');
            }
            process.exit(1);
        }

        const results = await scrapeMaruhan(null, storeConfig);
        console.log(`\n=== リアルタイム結果 (全${results.length}台 - ${storeConfig.name}) ===`);
        const high = results.filter(m => m.推定設定 >= 5);
        console.log(`設定5以上: ${high.length}台`);
        if (high.length > 0) {
            console.log(JSON.stringify(high.slice(0, 10), null, 2));
        }
    })();
}

module.exports = { scrapeMaruhan };
