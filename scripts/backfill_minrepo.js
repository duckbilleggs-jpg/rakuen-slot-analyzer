/**
 * backfill_minrepo.js — みんレポから過去データを一括取得してMongoDBに蓄積
 * 
 * Usage: node scripts/backfill_minrepo.js [日数]
 * Example: node scripts/backfill_minrepo.js 30   ← 過去30日分を取得
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
// プロジェクトルートに移動
process.chdir(ROOT);

require('dotenv').config({ path: path.join(ROOT, '.env') });
const { connectDB, Machine } = require(path.join(ROOT, 'database'));
const { scrapeRecent, normalizeDateKey } = require(path.join(ROOT, 'scraper'));
const { updateDBForNewMachines } = require(path.join(ROOT, 'machine_lookup'));

const DAYS = parseInt(process.argv[2]) || 30;

(async () => {
  console.log(`[Backfill] 過去${DAYS}日分のデータを全店舗から取得します...`);
  
  await connectDB();
  console.log('[Backfill] DB接続完了');
  
  const config = JSON.parse(require('fs').readFileSync('config.json', 'utf-8'));
  const allNames = [];
  
  for (const store of config.stores) {
    console.log(`\n=== ${store.name} (${store.id}) ===`);
    
    // 取得前のデータ数を確認
    const beforeCount = await Machine.countDocuments({ storeId: store.id });
    const beforeDates = await Machine.distinct('dateKey', { storeId: store.id });
    console.log(`[Backfill] 取得前: ${beforeCount}件, ${beforeDates.length}日分`);
    
    try {
      const data = await scrapeRecent(DAYS, store);
      const keys = Object.keys(data);
      console.log(`[Backfill] ${store.name}: ${keys.length}日分取得完了`);
      
      for (const day of Object.values(data)) {
        for (const m of day.machines) {
          allNames.push(m.機種名);
        }
      }
    } catch (err) {
      console.error(`[Backfill] ${store.name} エラー: ${err.message}`);
    }
    
    // 取得後のデータ数を確認
    const afterCount = await Machine.countDocuments({ storeId: store.id });
    const afterDates = await Machine.distinct('dateKey', { storeId: store.id });
    console.log(`[Backfill] 取得後: ${afterCount}件, ${afterDates.length}日分 (+${afterCount - beforeCount}件, +${afterDates.length - beforeDates.length}日)`);
    console.log(`[Backfill] 全日付: ${afterDates.sort().join(', ')}`);
  }
  
  // 不正なdateKeyのクリーンアップ
  console.log('\n=== 不正データのクリーンアップ ===');
  const invalidDocs = await Machine.find({ dateKey: { $regex: /^\d{4}-\d{2}-\d{3,}/ } });
  if (invalidDocs.length > 0) {
    console.log(`[Backfill] 不正なdateKey: ${invalidDocs.length}件検出。削除します...`);
    await Machine.deleteMany({ dateKey: { $regex: /^\d{4}-\d{2}-\d{3,}/ } });
    console.log('[Backfill] 削除完了');
  } else {
    console.log('[Backfill] 不正なdateKeyなし');
  }
  
  // 未知機種の自動検索
  if (allNames.length > 0) {
    console.log('\n=== 未知機種の検索 ===');
    await updateDBForNewMachines(allNames);
  }
  
  // 最終確認
  console.log('\n=== 最終データ状況 ===');
  for (const store of config.stores) {
    const count = await Machine.countDocuments({ storeId: store.id });
    const dates = await Machine.distinct('dateKey', { storeId: store.id });
    console.log(`${store.name}: ${count}件, ${dates.length}日分 (${dates.sort()[0]} 〜 ${dates.sort().slice(-1)[0]})`);
  }
  
  console.log('\n[Backfill] 完了！');
  process.exit(0);
})().catch(err => {
  console.error('[Backfill] 致命的エラー:', err);
  process.exit(1);
});
