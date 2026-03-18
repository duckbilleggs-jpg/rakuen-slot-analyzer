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
            }
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
        console.error(`[CLI] エラー: 指定された店舗ID '${storeId}' がconfig.jsonに見つかりません。`);
        process.exit(1);
    }

    console.log(`[CLI] リアルタイムスクレイプ開始 (${storeConfig.name})...`);
    console.log(`[CLI] 時刻: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
    
    try {
        // MongoDB接続（削除し、API送信方式へ）
        console.log('[CLI] ファイアウォール回避のためWEB経由でのデータ保存を開始します');
        
        // スクレイプ実行
        const data = await scrapeDDelta((current, total, modelName) => {
            if (current % 5 === 0 || current === 1) {
                console.log(`[CLI] 進捗: ${current}/${total} - ${modelName}`);
            }
        }, storeConfig);
        
        console.log(`[CLI] スクレイプ完了: ${data.length}台`);
        
        if (data.length > 0) {
            // WEB API送信
            // WEB_APP_URLが未設定ならローカルホスト（検証用）を使用
            const WEB_APP_URL = process.env.WEB_APP_URL || 'http://localhost:3000';
            const apiUrl = `${WEB_APP_URL}/api/upload-realtime`;
            
            console.log(`[CLI] Webサーバーへデータを安全に転送中... (${apiUrl})`);
            
            try {
                await pushDataToApi(apiUrl, {
                    storeId: storeId,
                    machines: data,
                    timestamp: new Date().toISOString()
                });
                console.log(`[CLI] ✨ Webサーバー経由でMongoDBへの保存に成功しました！`);
            } catch (apiErr) {
                console.error(`[CLI] ❌ データ送信エラー: ${apiErr.message}`);
                console.error(`[CLI] 解決策: .envファイルに Renderの公開URL (WEB_APP_URL=https://あなたのアプリ.onrender.com) を記載してください。`);
            }
            
            // 設定5以上の台をサマリー表示
            const high = data.filter(m => m.推定設定 >= 5);
            console.log(`[CLI] 設定5以上: ${high.length}台`);
            high.slice(0, 5).forEach(m => {
                console.log(`  ${m.機種名} 台番${m.台番} 設定${m.推定設定} ${m.実質確率} 期待値¥${m.期待値円}`);
            });
        } else {
            console.log('[CLI] データ0台のため保存をスキップしました');
        }
        
        process.exit(0);
    } catch (e) {
        console.error('[CLI] エラー:', e);
        process.exit(1);
    }
})();
