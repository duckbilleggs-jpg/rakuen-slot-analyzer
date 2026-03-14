/**
 * migrate_to_mongo.js
 * ローカルの data/*.json ファイルを MongoDB へ一括登録するマイグレーションスクリプト
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const DATA_DIR = path.join(__dirname, 'data');
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('[Migrate] MONGODB_URI が .env に設定されていません。');
  process.exit(1);
}

const machineSchema = new mongoose.Schema({
  dateKey: { type: String, required: true },
  reportId: { type: String },
  dateRaw: { type: String },
  機種名: { type: String },
  台番: { type: Number },
  差枚: { type: Number, default: 0 },
  G数: { type: Number, default: 0 },
  出率: { type: Number, default: 0 }
}, { collection: 'machines' });

machineSchema.index({ dateKey: 1, 台番: 1 }, { unique: true });

const Machine = mongoose.model('Machine', machineSchema);

async function migrate() {
  console.log('[Migrate] MongoDBに接続中...');
  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 60000,
    connectTimeoutMS: 30000
  });
  console.log('[Migrate] 接続成功！');

  if (!fs.existsSync(DATA_DIR)) {
    console.log('[Migrate] dataディレクトリが存在しません。');
    process.exit(0);
  }

  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.log('[Migrate] 移行するデータファイルがありません。');
    process.exit(0);
  }

  for (const file of files) {
    const dateKey = file.replace('.json', '');
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));

    if (!data.machines || data.machines.length === 0) continue;

    console.log(`[Migrate] ${dateKey} (${data.machines.length}台) を移行中...`);
    const BATCH_SIZE = 30;
    let saved = 0;

    for (let i = 0; i < data.machines.length; i += BATCH_SIZE) {
      const batch = data.machines.slice(i, i + BATCH_SIZE);
      const ops = batch.map(m => ({
        updateOne: {
          filter: { dateKey, 台番: m.台番 },
          update: {
            $set: {
              reportId: data.id,
              dateRaw: data.date,
              機種名: m.機種名,
              差枚: m.差枚,
              G数: m.G数,
              出率: m.出率
            }
          },
          upsert: true
        }
      }));

      try {
        await Machine.bulkWrite(ops, { ordered: false });
        saved += batch.length;
        process.stdout.write(`\r  → ${saved}/${data.machines.length} 件保存...`);
      } catch (err) {
        console.error(`\n  エラー (バッチ${Math.floor(i/BATCH_SIZE)+1}):`, err.message.substring(0, 100));
      }
    }
    console.log(`\n[Migrate] ${dateKey} 完了: ${saved}件`);
  }

  const total = await Machine.countDocuments();
  console.log(`\n✅ マイグレーション完了！ MongoDB 合計 ${total} 件`);
  process.exit(0);
}

migrate().catch(e => {
  console.error('[Migrate] エラー:', e.message);
  process.exit(1);
});
