/**
 * fix_mojibake_db.js — MongoDB内の文字化け機種名(U+FFFD)を正規名へ修復
 *
 * 単体実行:
 *   node fix_mojibake_db.js --dry-run   # 変更内容の確認のみ
 *   node fix_mojibake_db.js             # 実際に更新
 *
 * サーバー組み込み:
 *   const { fixMojibake } = require('./fix_mojibake_db');
 *   await fixMojibake();   // 接続済みのmongooseを利用
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// .env から MONGODB_URI を読む(dotenv非依存)
function loadEnvUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf-8').match(/^MONGODB_URI=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

// 文字化け名 → 正規名の解決関数を作る
function makeResolver(canonicalNames) {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return function resolve(name) {
    if (!name || !name.includes('�')) return null;
    try {
      const re = new RegExp('^' + name.split(/�+/).map(esc).join('.{0,4}') + '$');
      const hits = canonicalNames.filter(k => re.test(k));
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) {
        hits.sort((a, b) => Math.abs(a.length - name.length) - Math.abs(b.length - name.length));
        return hits[0];
      }
    } catch (e) { /* ignore */ }
    return null;
  };
}

function getModels() {
  const Machine = mongoose.models.Machine
    || mongoose.model('Machine', new mongoose.Schema({}, { strict: false, collection: 'machines' }));
  const RealtimeCache = mongoose.models.RealtimeCache
    || mongoose.model('RealtimeCache', new mongoose.Schema({}, { strict: false, collection: 'realtime_cache' }));
  return { Machine, RealtimeCache };
}

/**
 * 文字化け機種名の一括修復（冪等・文字化けが無ければdistinct1回で終了）
 * @param {Object} [opts] - { dryRun: boolean }
 * @returns {Object} { fixedRecords, fixedNames, unresolved, rtFixed }
 */
async function fixMojibake(opts = {}) {
  const dryRun = !!opts.dryRun;
  const { Machine, RealtimeCache } = getModels();

  // 正規名候補 = machine_db.jsonのキー + Mongo内の文字化けしていない機種名
  const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'machine_db.json'), 'utf-8'));
  const dbKeys = Object.keys(db).filter(k => !k.includes('�'));
  const allNames = await Machine.distinct('機種名');
  const cleanNames = allNames.filter(n => n && !n.includes('�'));
  const canonical = [...new Set([...dbKeys, ...cleanNames])];
  const resolve = makeResolver(canonical);

  // 1) machines コレクション
  const badNames = allNames.filter(n => n && n.includes('�'));
  let fixedRecords = 0, fixedNames = 0;
  const unresolved = [];
  for (const bad of badNames) {
    const canon = resolve(bad);
    if (canon) {
      const count = await Machine.countDocuments({ 機種名: bad });
      console.log(`[MojibakeFix] ✅ "${bad}" → "${canon}" (${count}件)${dryRun ? ' [dry-run]' : ''}`);
      if (!dryRun) await Machine.updateMany({ 機種名: bad }, { $set: { 機種名: canon } });
      fixedRecords += count; fixedNames++;
    } else {
      console.log(`[MojibakeFix] ❌ 解決不可: "${bad}"`);
      unresolved.push(bad);
    }
  }

  // 2) realtime_cache コレクション
  let rtFixed = 0;
  const caches = await RealtimeCache.find({}).lean();
  for (const c of caches) {
    if (!Array.isArray(c.machines)) continue;
    let changed = false;
    const machines = c.machines.map(m => {
      if (m && m.機種名 && m.機種名.includes('�')) {
        const canon = resolve(m.機種名);
        if (canon) { changed = true; rtFixed++; return { ...m, 機種名: canon }; }
      }
      return m;
    });
    if (changed && !dryRun) {
      await RealtimeCache.updateOne({ _id: c._id }, { $set: { machines } });
    }
  }

  if (badNames.length > 0 || rtFixed > 0) {
    console.log(`[MojibakeFix] 完了: 機種名${fixedNames}種/${fixedRecords}レコード修正、リアルタイム${rtFixed}台修正、解決不可${unresolved.length}種${dryRun ? ' (dry-run)' : ''}`);
  }
  return { fixedRecords, fixedNames, unresolved, rtFixed };
}

module.exports = { fixMojibake };

// CLI実行
if (require.main === module) {
  (async () => {
    const uri = loadEnvUri();
    if (!uri) { console.error('MONGODB_URI が見つかりません (.env)'); process.exit(1); }
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000, family: 4 });
    console.log('[MojibakeFix] MongoDB接続OK');
    await fixMojibake({ dryRun: process.argv.includes('--dry-run') });
    await mongoose.disconnect();
  })().catch(e => { console.error('[MojibakeFix] エラー:', e.message); process.exit(1); });
}
