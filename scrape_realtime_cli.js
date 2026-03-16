/**
 * scrape_realtime_cli.js — GitHub ActionsからCLIで実行するリアルタイムスクレイプ
 * 結果をMongoDBに保存する
 */
require('dotenv').config();
const { connectDB, RealtimeCache } = require('./database');
const { scrapeDDelta } = require('./scraper_ddelta');

(async () => {
    console.log('[CLI] リアルタイムスクレイプ開始...');
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
        });
        
        console.log(`[CLI] スクレイプ完了: ${data.length}台`);
        
        if (data.length > 0) {
            // MongoDBに保存
            await RealtimeCache.findOneAndUpdate(
                { key: 'latest' },
                { machines: data, timestamp: new Date().toISOString() },
                { upsert: true }
            );
            console.log(`[CLI] MongoDBに${data.length}台のリアルタイムデータを保存完了`);
            
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
