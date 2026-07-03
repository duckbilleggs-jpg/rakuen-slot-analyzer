/**
 * analyzer.js — 設定判別 + 期待値計算エンジン
 */
const fs = require('fs');
const path = require('path');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
const { loadDB, getDefaultSpecs, findSpecs } = require('./machine_lookup');

/**
 * 機種タイプ別の1ゲームあたり差枚の標準偏差（枚）
 * AT機は荒く、ノーマル機はマイルド。出率の標準偏差(%)は
 * σ_rate = σ_coin / (3 × √G) × 100 で求まる。
 */
const TYPE_SIGMA = { 'A': 6, 'A+AT': 9, 'AT': 16 };

/**
 * 実出率とG数から各設定の事後確率を計算（正規近似ベイズ）
 * @param {number} actualRate - 実出率(%)
 * @param {number} games - 総ゲーム数
 * @param {Object} specs - 機種スペック (s1..s6, type)
 * @returns {Object|null} { posterior: {1:p,...}, best: 設定, p56: 設定5以上の確率 }
 */
function settingPosterior(actualRate, games, specs) {
  if (!actualRate || actualRate <= 0 || !games || games <= 0) return null;
  const sigmaCoin = TYPE_SIGMA[specs.type] || TYPE_SIGMA['AT'];
  const sigmaRate = (sigmaCoin / (3 * Math.sqrt(games))) * 100;

  const settings = [];
  for (let s = 1; s <= 6; s++) {
    if (specs[`s${s}`]) settings.push({ label: s, theo: specs[`s${s}`] });
  }
  if (settings.length < 2) return null;

  // 尤度（一様事前分布）
  let total = 0;
  for (const st of settings) {
    const z = (actualRate - st.theo) / sigmaRate;
    st.lik = Math.exp(-0.5 * z * z);
    total += st.lik;
  }
  if (total <= 0) {
    // 全設定から極端に外れている場合は最も近い設定に確率1
    let nearest = settings[0];
    for (const st of settings) {
      if (Math.abs(actualRate - st.theo) < Math.abs(actualRate - nearest.theo)) nearest = st;
    }
    nearest.lik = 1; total = 1;
  }

  const posterior = {};
  let best = settings[0], p56 = 0;
  for (const st of settings) {
    const p = st.lik / total;
    posterior[st.label] = p;
    if (p > (posterior[best.label] || 0)) best = st;
    if (st.label >= 5) p56 += p;
  }
  return { posterior, best: best.label, p56 };
}

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

  // 設定5以上と判定する事後確率のしきい値（config.analysis.minP56 で調整可）
  const minP56 = (currentConfig.analysis && currentConfig.analysis.minP56) || 0.5;

  for (const m of machines) {
    // G数が最低基準未満 → スキップ
    if (m.G数 < currentConfig.analysis.minGames) continue;

    // 機種の理論値を取得（文字化け機種名にも対応）
    const specs = findSpecs(m.機種名, db) || getDefaultSpecs();

    // ベイズ推定: 各設定の事後確率
    const est = settingPosterior(m.出率, m.G数, specs);
    if (!est) continue;

    // 設定5以上の事後確率がしきい値未満 → スキップ
    if (est.p56 < minP56 || est.best < 5) continue;

    const estimatedSetting = est.best;

    // 信頼度 = 設定5以上の事後確率(%) をG数信頼度で減衰
    const gamesFactor = Math.min(1, Math.sqrt(m.G数 / 6000));
    const confidence = Math.round(est.p56 * 100 * gamesFactor);

    // 期待値計算: 差枚ベース (リアルタイムと同じ方式)
    const coinRate = currentConfig.analysis.coinRate || 46;
    const inPerGame = currentConfig.analysis.inPerGame || 3;
    const 期待値円 = Math.round((m.差枚 || 0) * (coinRate / inPerGame));

    results.push({
      ...m,
      推定設定: estimatedSetting,
      設定56確率: Math.round(est.p56 * 100),
      信頼度: confidence,
      信頼度ラベル: confidenceLabel(confidence),
      理論出率: specs[`s${estimatedSetting}`],
      期待値円: 期待値円,
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
    const specs = findSpecs(m.機種名, db) || getDefaultSpecs();
    let estimatedSetting = estimateSetting(m.出率, specs, m.G数);

    return {
      ...m,
      推定設定: estimatedSetting,
      理論出率対応: specs
    };
  });
}

/**
 * 出率から推定設定を算出
 * G数が与えられればベイズ推定(最尤設定)、なければ最近傍の理論出率
 */
function estimateSetting(actualRate, specs, games) {
  if (!actualRate || actualRate <= 0) return '?';

  if (games && games > 0) {
    const est = settingPosterior(actualRate, games, specs);
    if (est) return est.best;
  }

  // フォールバック: 最も理論出率が近い設定
  let best = null, bestDiff = Infinity;
  for (let s = 1; s <= 6; s++) {
    const theo = specs[`s${s}`];
    if (!theo) continue;
    const diff = Math.abs(actualRate - theo);
    if (diff < bestDiff) { bestDiff = diff; best = s; }
  }
  return best || '?';
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

module.exports = { analyzeHighSetting, analyzeAll, calcExpectedValue, estimateSetting, settingPosterior };
