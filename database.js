const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;

/**
 * データベースへの接続
 */
async function connectDB() {
  if (!MONGODB_URI) {
    console.error('[DB] MONGODB_URI が環境変数に設定されていません。');
  } else {
    try {
      if (mongoose.connection.readyState === 0) {
        await mongoose.connect(MONGODB_URI, {
          serverSelectionTimeoutMS: 30000,
          socketTimeoutMS: 60000,
          connectTimeoutMS: 30000,
          family: 4
        });
        console.log('[DB] MongoDBに接続しました。');
      }
    } catch (e) {
      console.error('[DB] MongoDB接続エラー:', e.message);
      throw e; // 呼び出し元でエラーを検知できるように再スロー
    }
  }
}

// ============================
// Data Schemas
// ============================

const machineSchema = new mongoose.Schema({
  storeId: { type: String, default: 'tachikawa', index: true }, // 店舗識別子
  dateKey: { type: String, required: true, index: true }, // "YYYY-MM-DD" etc
  reportId: { type: String }, // min-repo url ID
  dateRaw: { type: String }, // "3/13(金)" etc
  機種名: { type: String, required: true, index: true },
  台番: { type: Number, required: true },
  差枚: { type: Number, default: 0 },
  G数: { type: Number, default: 0 },
  出率: { type: Number, default: 0 }
}, { timestamps: false, collection: 'machines' });

// 複合インデックス: 同じ店舗・同じ日・同じ台番の重複防止用
machineSchema.index({ storeId: 1, dateKey: 1, 台番: 1 }, { unique: true });

const Machine = mongoose.models.Machine || mongoose.model('Machine', machineSchema);

// リアルタイムデータのキャッシュ用スキーマ
const realtimeCacheSchema = new mongoose.Schema({
  key: { type: String, default: 'latest_tachikawa', unique: true }, // 店舗ごとのキャッシュキー (latest_tachikawa, latest_sagamiharaなど)
  machines: { type: mongoose.Schema.Types.Mixed, default: [] },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: false, collection: 'realtime_cache' });

const RealtimeCache = mongoose.models.RealtimeCache || mongoose.model('RealtimeCache', realtimeCacheSchema);

module.exports = {
  connectDB,
  Machine,
  RealtimeCache
};
