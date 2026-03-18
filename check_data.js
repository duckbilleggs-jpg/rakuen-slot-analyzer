require('dotenv').config();
const { connectDB, RealtimeCache } = require('./database');

(async () => {
    try {
        await connectDB();
        const cached = await RealtimeCache.findOne({ key: 'latest' });
        if (cached) {
            console.log('=== MongoDBリアルタイムキャッシュ情報 ===');
            console.log('タイムスタンプ:', cached.timestamp);
            console.log('台数:', cached.machines ? cached.machines.length : 0);
            if (cached.machines && cached.machines.length > 0) {
                const high = cached.machines.filter(m => m.推定設定 >= 5);
                console.log('設定5以上:', high.length, '台');
                console.log('先頭5台:');
                cached.machines.slice(0, 5).forEach(m => {
                    console.log(`  ${m.機種名} 台番${m.台番} G数=${m.G数} 設定${m.推定設定}`);
                });
            }
        } else {
            console.log('リアルタイムキャッシュなし');
        }
        process.exit(0);
    } catch (e) {
        console.error('エラー:', e.message);
        process.exit(1);
    }
})();
