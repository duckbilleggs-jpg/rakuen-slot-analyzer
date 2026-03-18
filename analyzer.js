/**
 * analyzer.js — 設定判別 + 期待値計算エンジン
 */
const fs = require('fs');
const path = require('path');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
const { loadDB, getDefaultSpecs } = require('./machine_lookup');

/**
 * 設定判別＋期待値計算のメイン関数
 * @param {Array} machines - スクレイプした台データ配列
 * @param {Date} [asOfTime] - データ取得時刻（デフォルト: 現在時刻）
 * @param {string} [reportId] - 元データのレポートID
 * @returns {Array} 設定5以上と推定される台のリスト
 */
function analyzeHighSetting(machines, asOfTime = new Date(), reportId = null, currentConfig = config) {
  const db = loadDB();
  const results = [];

  for (const m of machines) {
    // G数が最低基準未満 → スキップ
    if (m.G数 < currentConfig.analysis.minGames) continue;

    // 機種の理論値を取得
    const specs = db[m.機種名] || getDefaultSpecs();

    // 設定5の理論出率がない場合スキップ
    if (!specs.s5) continue;

    // 実出率が設定5の理論値以上か判定
    if (m.出率 < specs.s5) continue;

    // 推定設定
    let estimatedSetting;
    if (specs.s6 && m.出率 >= specs.s6) {
      estimatedSetting = 6;
    } else {
      estimatedSetting = 5;
    }

    // 信頼度
    const confidence = calcConfidence(m.G数);

    // 期待値計算
    const ev = calcExpectedValue(specs, estimatedSetting, asOfTime, currentConfig);

    // 1Gあたりの期待枚数 (フロントエンドでの動적再計算用)
    const rate = specs[`s${estimatedSetting}`] || 108;
    const expectedSamaiPerG = (currentConfig.analysis.inPerGame || 3) * (rate - 100) / 100;

    results.push({
      ...m,
      推定設定: estimatedSetting,
      信頼度: confidence,
      信頼度ラベル: confidenceLabel(confidence),
      理論出率: specs[`s${estimatedSetting}`],
      期待枚数PerG: expectedSamaiPerG,
      残りG数: ev.残りG数,
      期待差枚: ev.期待差枚,
      期待値円: ev.期待値円,
      閉店まで: ev.閉店まで,
      reportId: reportId
    });
  }

  // 期待値円の降順でソート
  results.sort((a, b) => b.期待値円 - a.期待値円);

  return results;
}

/**
 * 全台データの分析（参考情報付き）
 */
function analyzeAll(machines) {
  const db = loadDB();

  return machines.map(m => {
    const specs = db[m.機種名] || getDefaultSpecs();
    let estimatedSetting = estimateSetting(m.出率, specs);

    return {
      ...m,
      推定設定: estimatedSetting,
      理論出率対応: specs
    };
  });
}

/**
 * 出率から推定設定を算出（全設定分）
 */
function estimateSetting(actualRate, specs) {
  if (!actualRate || actualRate <= 0) return '?';

  const settings = [
    { key: 's6', label: 6 },
    { key: 's5', label: 5 },
    { key: 's4', label: 4 },
    { key: 's3', label: 3 },
    { key: 's2', label: 2 },
    { key: 's1', label: 1 },
  ];

  for (const s of settings) {
    if (specs[s.key] && actualRate >= specs[s.key]) {
      return s.label;
    }
  }
  return 1;
}

/**
 * 信頼度スコア計算 (0〜100)
 */
function calcConfidence(games) {
  if (games >= 8000) return 95;
  if (games >= 6000) return 85;
  if (games >= 5000) return 75;
  if (games >= 4000) return 60;
  if (games >= 3000) return 45;
  if (games >= 2000) return 30;
  return 10;
}

function confidenceLabel(score) {
  if (score >= 80) return '★★★ 高';
  if (score >= 50) return '★★☆ 中';
  return '★☆☆ 低';
}

/**
 * 閉店までの期待値計算
 * @param {Object} specs - 機種の理論出率
 * @param {number} setting - 推定設定 (5 or 6)
 * @param {Date} asOfTime - データ取得時刻
 */
function calcExpectedValue(specs, setting, asOfTime, currentConfig = config) {
  const closingTime = new Date(asOfTime);
  closingTime.setHours(currentConfig.closingTime.hour, currentConfig.closingTime.minute, 0, 0);

  // 閉店を過ぎていたら翌日扱い... ではなく 0 とする
  const remainingMs = closingTime - asOfTime;
  if (remainingMs <= 0) {
    return { 残りG数: 0, 期待差枚: 0, 期待値円: 0, 閉店まで: '閉店済み' };
  }

  const remainingSec = remainingMs / 1000;
  const 残りG数 = Math.floor(remainingSec / currentConfig.analysis.secondsPerGame);

  // 理論出率(%)
  const theoreticalRate = specs[`s${setting}`] || 108;

  // 期待差枚 = 残りG数 × IN枚数(3枚) × (出率 - 100%) / 100
  const 期待差枚 = Math.round(残りG数 * currentConfig.analysis.inPerGame * (theoreticalRate - 100) / 100);

  // 期待値(円) = 期待差枚 × (貸し単価÷IN枚数)
  const 期待値円 = Math.round(期待差枚 * (currentConfig.analysis.coinRate / currentConfig.analysis.inPerGame));

  // 残り時間の表示
  const hrs = Math.floor(remainingSec / 3600);
  const mins = Math.floor((remainingSec % 3600) / 60);
  const 閉店まで = `${hrs}時間${mins}分`;

  return { 残りG数, 期待差枚, 期待値円, 閉店まで };
}

module.exports = { analyzeHighSetting, analyzeAll, calcExpectedValue, estimateSetting };
