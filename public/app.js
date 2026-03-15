/**
 * app.js — ダッシュボード フロントエンド
 */

let currentData = [];
let allMachineNames = [];

// ============================
// 初期化
// ============================
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  loadConfigUI();
  // 5分ごとに自動リフレッシュ
  setInterval(loadData, 5 * 60 * 1000);
  // 閉店カウントダウン更新
  setInterval(updateCountdown, 30000);
});

// ============================
// データ取得＆表示
// ============================
async function loadData() {
  try {
    const res = await fetch('/api/high-setting');
    const data = await res.json();

    currentData = data.machines || [];

    // サマリー更新
    document.getElementById('totalMachines').textContent = data.totalMachines || 0;
    document.getElementById('highSettingCount').textContent = currentData.length;
    document.getElementById('dateDisplay').textContent = data.date || '-';

    if (data.lastScrape) {
      const t = new Date(data.lastScrape);
      document.getElementById('lastUpdate').textContent =
        `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`;
    } else {
      document.getElementById('lastUpdate').textContent = '-';
    }

    // 取得中の場合はリトライ処理
    if (data.scrapeStatus === 'running') {
      document.getElementById('loading').style.display = 'flex';
      document.getElementById('loading').querySelector('p').textContent =
        'データを取得中です...しばらくお待ちください';
      updateStatus('running');
      setTimeout(loadData, 15000);
      return;
    }

    // データ有無にかかわらずローディングを非表示
    document.getElementById('loading').style.display = 'none';

    // テーブル描画
    try { updateCountdown(); } catch(e) { console.warn('updateCountdown:', e); }
    try { updateMachineFilter(); } catch(e) { console.warn('updateMachineFilter:', e); }
    try { renderTable(); } catch(e) { console.warn('renderTable:', e); }

    updateStatus('idle');

  } catch (e) {
    console.error('データ取得エラー:', e);
    // エラー時もローディングを非表示にして状態を更新
    document.getElementById('loading').style.display = 'none';
    updateStatus('error');
    // エラー時も30秒後にリトライ
    setTimeout(loadData, 30000);
  }
}

function updateCountdown() {
  const now = new Date();
  const closing = new Date(now);
  closing.setHours(22, 40, 0, 0);
  const diff = closing - now;
  if (diff <= 0) {
    document.getElementById('timeToClose').textContent = '閉店';
  } else {
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    document.getElementById('timeToClose').textContent = `${hrs}h ${mins}m`;
  }
}

function updateMachineFilter() {
  const names = [...new Set(currentData.map(m => m.機種名))].sort();
  const select = document.getElementById('machineFilter');
  const currentVal = select.value;

  // 既存オプション保持
  select.innerHTML = '<option value="all">全機種</option>';
  names.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });

  if (names.includes(currentVal)) select.value = currentVal;
}

// ============================
// テーブル描画
// ============================
function renderTable() {
  const sortKey = document.getElementById('sortSelect').value;
  const filterMachine = document.getElementById('machineFilter').value;

  let filtered = [...currentData];

  // 機種フィルタ
  if (filterMachine !== 'all') {
    filtered = filtered.filter(m => m.機種名 === filterMachine);
  }

  // ソート
  switch (sortKey) {
    case 'ev':
      filtered.sort((a, b) => b.期待値円 - a.期待値円);
      break;
    case 'setting':
      filtered.sort((a, b) => b.推定設定 - a.推定設定 || b.期待値円 - a.期待値円);
      break;
    case 'rate':
      filtered.sort((a, b) => b.出率 - a.出率);
      break;
    case 'confidence':
      filtered.sort((a, b) => b.信頼度 - a.信頼度 || b.期待値円 - a.期待値円);
      break;
    case 'samai':
      filtered.sort((a, b) => b.差枚 - a.差枚);
      break;
  }

  const table = document.getElementById('dataTable');
  const empty = document.getElementById('emptyState');
  const tbody = document.getElementById('tableBody');

  if (filtered.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  table.style.display = 'table';
  empty.style.display = 'none';

  tbody.innerHTML = filtered.map(m => {
    const settingClass = m.推定設定 === 6 ? 'setting-6' : 'setting-5';
    const badgeClass = m.推定設定 === 6 ? 'badge-6' : 'badge-5';
    const confClass = m.信頼度 >= 80 ? 'confidence-high' : m.信頼度 >= 50 ? 'confidence-mid' : 'confidence-low';
    const samaiClass = m.差枚 >= 0 ? 'td-positive' : 'td-negative';
    const evClass = m.期待値円 >= 0 ? 'td-positive' : 'td-negative';

    return `
      <tr class="${settingClass}">
        <td><span class="badge ${badgeClass}">設定${m.推定設定}</span></td>
        <td><span class="confidence ${confClass}">${m.信頼度ラベル}</span></td>
        <td class="machine-name" title="${m.機種名}">
          ${m.reportId ? `<a href="https://min-repo.com/${m.reportId}/?kishu=${encodeURIComponent(m.機種名)}" target="_blank" rel="noopener" style="color:var(--text-primary); text-decoration:underline;">${m.機種名}</a>` : m.機種名}
        </td>
        <td>${m.台番}</td>
        <td class="td-num">${m.出率.toFixed(1)}%</td>
        <td class="td-num ${samaiClass}">${m.差枚.toLocaleString()}</td>
        <td class="td-num">${m.G数.toLocaleString()}</td>
        <td class="td-num">${m.残りG数 ? m.残りG数.toLocaleString() : '-'}</td>
        <td class="td-num td-highlight">${m.期待差枚 ? (m.期待差枚 >= 0 ? '+' : '') + m.期待差枚.toLocaleString() : '-'}</td>
        <td class="td-num td-highlight ${evClass}">${m.期待値円 ? '¥' + m.期待値円.toLocaleString() : '-'}</td>
      </tr>
    `;
  }).join('');
}

// ============================
// 手動スクレイプ
// ============================
async function manualScrape() {
  const btn = document.getElementById('btnScrape');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin:0"></span> 取得中...';
  updateStatus('running');

  try {
    await fetch('/api/scrape', { method: 'POST' });
    // 15秒待ってからデータリロード
    setTimeout(async () => {
      await loadData();
      btn.disabled = false;
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/><polyline points="21 3 21 12 12 12"/></svg> データ取得';
    }, 15000);
  } catch (e) {
    console.error('スクレイプエラー:', e);
    btn.disabled = false;
    btn.innerHTML = 'エラー';
    updateStatus('error');
  }
}

// ============================
// ステータス表示
// ============================
function updateStatus(status) {
  const dot = document.querySelector('.status-dot');
  const text = document.getElementById('statusText');
  dot.className = 'status-dot';

  switch (status) {
    case 'idle':
      text.textContent = '待機中';
      break;
    case 'running':
      dot.classList.add('running');
      text.textContent = '取得中';
      break;
    case 'error':
      dot.classList.add('error');
      text.textContent = 'エラー';
      break;
  }
}

// ============================
// 設定パネル
// ============================
function toggleConfig() {
  const panel = document.getElementById('configPanel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

async function loadConfigUI() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();

    document.getElementById('cfgEnabled').checked = cfg.schedule.enabled;
    document.getElementById('cfgStartH').value = cfg.schedule.startHour;
    document.getElementById('cfgStartM').value = cfg.schedule.startMinute;
    document.getElementById('cfgEndH').value = cfg.schedule.endHour;
    document.getElementById('cfgEndM').value = cfg.schedule.endMinute;
    document.getElementById('cfgInterval').value = cfg.schedule.intervalMinutes;
    document.getElementById('cfgCloseH').value = cfg.closingTime.hour;
    document.getElementById('cfgCloseM').value = cfg.closingTime.minute;
    document.getElementById('cfgMinGames').value = cfg.analysis.minGames;
    document.getElementById('cfgSecPerGame').value = cfg.analysis.secondsPerGame;

    // フッタースケジュール表示
    if (cfg.schedule.enabled) {
      document.getElementById('footerSchedule').textContent =
        `${cfg.schedule.startHour}:${String(cfg.schedule.startMinute).padStart(2, '0')}〜${cfg.schedule.endHour}:${String(cfg.schedule.endMinute).padStart(2, '0')} / ${cfg.schedule.intervalMinutes}分間隔`;
    } else {
      document.getElementById('footerSchedule').textContent = '無効';
    }
  } catch (e) {
    console.error('設定取得エラー:', e);
  }
}

async function saveConfig() {
  const cfg = {
    schedule: {
      enabled: document.getElementById('cfgEnabled').checked,
      startHour: parseInt(document.getElementById('cfgStartH').value),
      startMinute: parseInt(document.getElementById('cfgStartM').value),
      endHour: parseInt(document.getElementById('cfgEndH').value),
      endMinute: parseInt(document.getElementById('cfgEndM').value),
      intervalMinutes: parseInt(document.getElementById('cfgInterval').value)
    },
    closingTime: {
      hour: parseInt(document.getElementById('cfgCloseH').value),
      minute: parseInt(document.getElementById('cfgCloseM').value)
    },
    analysis: {
      minGames: parseInt(document.getElementById('cfgMinGames').value),
      secondsPerGame: parseFloat(document.getElementById('cfgSecPerGame').value),
      coinRate: 46,
      inPerGame: 3
    },
    scrape: {
      storeTag: "楽園立川店",
      baseUrl: "https://min-repo.com",
      requestIntervalMs: 1000
    }
  };

  try {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg)
    });
    toggleConfig();
    loadConfigUI();
    alert('設定を保存しました');
  } catch (e) {
    alert('設定保存エラー: ' + e.message);
  }
}
