/**
 * calibrate_realtime.js — リアルタイム設定判別しきい値の実測較正
 *
 * 問題: d-deltanetのBB/RB/ART列の意味が機種ごとに異なるため、
 *       公表スペック由来のしきい値と実測確率が噛み合わず過剰判定になる。
 * 解決: 実際のホールデータ(リアルタイムキャッシュ)から機種ごとの
 *       「実測ベース確率」を求め、ホール中央値≒低設定と仮定して
 *       公表スペックの設定間比率でしきい値をスケーリングする。
 *
 * Usage: node calibrate_realtime.js [--apply] [サーバーURL]
 *   --apply なし: レポート表示のみ / あり: machine_db.json を更新
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const SERVER = (process.argv.find(a => a.startsWith('http')) || 'https://rakuen-slot-analyzer.onrender.com').replace(/\/$/, '');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
const DB_PATH = path.join(__dirname, 'machine_db.json');
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));

const SET_ORDER = ['s1', 's2', 's3', 's4', 's5', 's6'];

function median(arr) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 公表分母(欠番は線形補間)を返す { d1..d6 } */
function interpDenoms(denoms) {
  const pts = [];
  SET_ORDER.forEach((k, i) => { if (denoms && denoms[k]) pts.push([i, denoms[k]]); });
  if (pts.length < 2) return null;
  const filled = [];
  for (let i = 0; i < 6; i++) {
    const exact = pts.find(p => p[0] === i);
    if (exact) { filled[i] = exact[1]; continue; }
    const lower = pts.filter(p => p[0] < i).pop();
    const upper = pts.find(p => p[0] > i);
    if (lower && upper) filled[i] = lower[1] + (upper[1] - lower[1]) * (i - lower[0]) / (upper[0] - lower[0]);
    else if (upper) filled[i] = upper[1];
    else filled[i] = lower[1];
  }
  return filled; // index 0..5 = 設定1..6
}

(async () => {
  // 1) 全店舗のリアルタイムデータを収集
  const all = [];
  for (const store of config.stores) {
    try {
      const res = await fetch(`${SERVER}/api/realtime?store=${store.id}`);
      const json = await res.json();
      const machines = json.machines || [];
      console.log(`[Calib] ${store.id}: ${machines.length}台`);
      all.push(...machines);
    } catch (e) {
      console.log(`[Calib] ${store.id}: 取得失敗 ${e.message}`);
    }
  }

  // 2) 機種別に実測ヒット確率を集計
  const byModel = {};
  for (const m of all) {
    if (!m.機種名 || !m.G数 || m.G数 < 2000) continue;
    (byModel[m.機種名] = byModel[m.機種名] || []).push(m);
  }

  let calibrated = 0, skipped = 0, before56 = 0, after56 = 0;

  for (const [name, machines] of Object.entries(byModel)) {
    const spec = db[name];
    const denomsSrc = spec ? (spec.type === 'A' || spec.type === 'A+AT' ? spec.gassan : spec.at) : null;
    const published = interpDenoms(denomsSrc);

    // 実際にヒットが入っている列を判定
    const colHits = { BB: 0, RB: 0, ART: 0 };
    for (const m of machines) {
      if ((m.BB回数 || 0) > 0) colHits.BB++;
      if ((m.RB回数 || 0) > 0) colHits.RB++;
      if ((m.ART回数 || 0) > 0) colHits.ART++;
    }
    const activeCols = Object.keys(colHits).filter(c => colHits[c] >= machines.length * 0.3);
    if (activeCols.length === 0) { skipped++; continue; }

    const denoms = machines.map(m => {
      const hits = activeCols.reduce((s, c) => s + (m[`${c}回数`] || 0), 0);
      return hits > 0 ? m.G数 / hits : null;
    }).filter(Boolean);
    if (denoms.length < 4) { skipped++; continue; }
    const obsMedian = median(denoms);

    // ホール中央値 ≒ 設定1〜2水準と仮定し、公表比率でしきい値をスケール
    // 公表データが無い機種はデフォルト比率(設定6=基準の82%, 設定5=88%, 設定4=93%)を使用
    let ratio6, ratio5, ratio4;
    if (published) {
      const d1 = published[0];
      ratio6 = ((published[4] + published[5]) / 2) / d1; // mid(d5,d6)/d1
      ratio5 = ((published[3] + published[4]) / 2) / d1;
      ratio4 = ((published[2] + published[3]) / 2) / d1;
    } else {
      ratio6 = 0.82; ratio5 = 0.88; ratio4 = 0.93;
    }

    const th = {
      s6: Math.round(obsMedian * ratio6 * 10) / 10,
      s5: Math.round(obsMedian * ratio5 * 10) / 10,
      s4: Math.round(obsMedian * ratio4 * 10) / 10
    };

    // 判定シミュレーション (before/after の設定5以上台数)
    const oldTh = (spec && spec.probThresholds) || { s6: 220, s5: 250, s4: 300 };
    for (const m of machines) {
      const hits = activeCols.reduce((s, c) => s + (m[`${c}回数`] || 0), 0);
      if (hits === 0) continue;
      const p = m.G数 / hits;
      if (p <= oldTh.s5) before56++;
      if (p <= th.s5) after56++;
    }

    console.log(`  ${name.slice(0, 28)} [${activeCols.join('+')}] n=${denoms.length} 実測中央値=1/${obsMedian.toFixed(1)} → th6=${th.s6} th5=${th.s5}${published ? '' : ' (比率デフォルト)'}`);

    if (APPLY) {
      const entry = db[name] || { type: 'AT' };
      entry.hitCols = activeCols;
      entry.probThresholds = th;
      entry.calibration = {
        method: 'hall-median-scaling',
        samples: denoms.length,
        observedMedian: Math.round(obsMedian * 10) / 10,
        calibratedAt: new Date().toISOString().slice(0, 10)
      };
      db[name] = entry;
      calibrated++;
    }
  }

  console.log(`\n[Calib] 較正対象: ${Object.keys(byModel).length}機種, 較正: ${APPLY ? calibrated : '(dry-run)'}, スキップ: ${skipped}`);
  console.log(`[Calib] 設定5以上判定シミュレーション: 旧しきい値=${before56}台 → 新しきい値=${after56}台`);

  if (APPLY) {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
    console.log('[Calib] machine_db.json を更新しました');
  }
})().catch(e => { console.error('[Calib] エラー:', e); process.exit(1); });
