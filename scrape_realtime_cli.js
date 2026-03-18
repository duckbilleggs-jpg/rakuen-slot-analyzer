/**
 * scrape_realtime_cli.js — GitHub ActionsからCLIで実行するリアルタイムスクレイプ
 * 結果をMongoDBに保存する
 */
require('dotenv').config();
const { connectDB, RealtimeCache } = require('./database');
const { scrapeDDelta } = require('./scraper_ddelta');
const fs = require('fs');
const path = require('path');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));

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
        // MongoDB接続
        await connectDB();
        console.log('[CLI] MongoDB接続完了');
        
        // スクレイプ実行
        const data = await scrapeDDelta((current, total, modelName) => {
            if (current % 5 === 0 || current === 1) {
                console.log(`[CLI] 進捗: ${current}/${total} - ${modelName}`);
            }
        }, storeConfig);
        
        console.log(`[CLI] スクレイプ完了: ${data.length}台`);
        
        if (data.length > 0) {
            // MongoDBに保存
            const cacheKey = `latest_${storeId}`;
            await RealtimeCache.findOneAndUpdate(
                { key: cacheKey },
                { machines: data, timestamp: new Date().toISOString() },
                { upsert: true }
            );
            console.log(`[CLI] MongoDBに${data.length}台のリアルタイムデータを保存完了 (キー: ${cacheKey})`);
            
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
