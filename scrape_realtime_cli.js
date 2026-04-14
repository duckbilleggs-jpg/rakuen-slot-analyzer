/**
 * scrape_realtime_cli.js — GitHub Actions/PADからCLIで実行するリアルタイムスクレイプ
 * 社内ネットワーク等のMongoDBポート(27017)制限を回避するため、
 * スクリプトからは直接DB接続せず、RenderサーバーのAPI(HTTPS)経由で保存します。
 */
require('dotenv').config();
const { scrapeDDelta } = require('./scraper_ddelta');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));

// 強制終了タイマー（15分で強制終了）
const FORCE_EXIT_MS = 15 * 60 * 1000;
const forceExitTimer = setTimeout(() => {
    console.error('[SVC] Process timeout. Exiting.');
    process.exit(2);
}, FORCE_EXIT_MS);
forceExitTimer.unref(); // Node.jsの終了をブロックしない

function pushDataToApi(apiUrl, payloadObj) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(apiUrl);
        const engine = urlObj.protocol === 'https:' ? https : http;
        const payloadStr = Buffer.from(JSON.stringify(payloadObj));
        
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': payloadStr.length
            },
            timeout: 30000 // 30秒タイムアウト
        };
        
        const req = engine.request(urlObj, options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(body);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${body}`));
                }
            });
        });
        
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('API送信タイムアウト (30秒)'));
        });
        req.on('error', reject);
        req.write(payloadStr);
        req.end();
    });
}

(async () => {
    const args = process.argv.slice(2);
    let storeId = 'tachikawa';
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--store' && args[i+1]) storeId = args[++i];
    }
    
    const storeConfig = config.stores.find(s => s.id === storeId);
    if (!storeConfig) {
        console.error(`[SVC] Error: target '${storeId}' not found in config.`);
        process.exit(1);
    }

    console.log(`[SVC] Task started (target: ${storeId})`);
    console.log(`[SVC] Time: ${new Date().toISOString()}`);
    
    try {
        console.log('[SVC] Initializing remote sync...');
        
        // スクレイプ実行
        let data = [];
        if (storeConfig.type === 'maruhan') {
            const { scrapeMaruhan } = require('./scraper_maruhan');
            data = await scrapeMaruhan((current, total) => {
                if (current % 50 === 0 || current === 1) {
                    console.log(`[SVC] Processing: ${current}/${total}`);
                }
            }, storeConfig);
        } else if (storeId === 'kinshicho') {
            const { scrapeDeltanetPscube } = require('./scraper_pscube');
            data = await scrapeDeltanetPscube();
        } else if (!storeConfig.ddelta) {
            console.log(`[SVC] Target ${storeId} not supported, skipping.`);
            data = [];
        } else if (storeConfig.usePuppeteer) {
            // Puppeteer方式（人間操作模倣 / ボット検知回避）
            console.log(`[SVC] Using Puppeteer mode for ${storeId}`);
            const { scrapeDDeltaPuppeteer } = require('./scraper_ddelta_puppeteer');
            data = await scrapeDDeltaPuppeteer((current, total, modelName) => {
                if (current % 5 === 0 || current === 1) {
                    console.log(`[SVC] Processing: ${current}/${total}`);
                }
            }, storeConfig);
        } else {
            data = await scrapeDDelta((current, total, modelName) => {
                if (current % 5 === 0 || current === 1) {
                    console.log(`[SVC] Processing: ${current}/${total}`);
                }
            }, storeConfig);
        }
        
        console.log(`[SVC] Collection complete: ${data.length} items`);
        
        if (data.length > 0) {
            const WEB_APP_URL = process.env.WEB_APP_URL || 'http://localhost:7731';
            const apiUrl = `${WEB_APP_URL}/api/upload-realtime`;
            
            console.log(`[SVC] Uploading data...`);
            
            try {
                await pushDataToApi(apiUrl, {
                    storeId: storeId,
                    machines: data,
                    timestamp: new Date().toISOString()
                });
                console.log(`[SVC] Sync successful.`);
            } catch (apiErr) {
                console.error(`[SVC] Sync error: ${apiErr.message}`);
                console.error(`[SVC] Check endpoint config in .env file.`);
            }
            
            // Summary (counts only, no details)
            const high = data.filter(m => m.推定設定 >= 5);
            console.log(`[SVC] Flagged items: ${high.length}`);
        } else {
            console.log('[SVC] No data collected, skipping upload.');
        }
        
        clearTimeout(forceExitTimer);
        process.exit(0);
    } catch (e) {
        console.error('[SVC] Error:', e.message || e);
        clearTimeout(forceExitTimer);
        process.exit(1);
    }
})();
