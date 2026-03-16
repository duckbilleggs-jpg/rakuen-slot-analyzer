/**
 * app.js — ダッシュボード フロントエンド
 */

let currentData = {
  past: [],
  realtime: [],
  forecast: []
};
let activeTab = 'past';
let allMachineNames = [];

// ============================
// 初期化
// ============================
document.addEventListener('DOMContentLoaded', () => {
  switchTab('past'); // 初期表示タブ
  loadConfigUI();
  // 5分ごとに自動リフレッシュ
  setInterval(() => {
    if (activeTab === 'past') fetchPastData();
    else if (activeTab === 'realtime') fetchRealtimeData();
    else if (activeTab === 'forecast') fetchForecastData();
  }, 5 * 60 * 1000);
  // 閉店カウントダウン更新
  setInterval(updateCountdown, 30000);
});

// ============================
// タブ切り替え
// ============================
function switchTab(tabId) {
  activeTab = tabId;
  
  // タブボタンのアクティブ状態更新
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`tab-${tabId}`).classList.add('active');

  // テーブルコンテナ等の表示切り替え
  document.getElementById('dataTablePast').style.display = 'none';
  document.getElementById('dataTableRealtime').style.display = 'none';
  document.getElementById('dataTableForecast').style.display = 'none';
  document.getElementById('emptyState').style.display = 'none';
  
  // フィルタバーやサマリーカードの表示調整
  document.getElementById('filterBarPast').style.display = (tabId === 'past') ? 'flex' : 'none';
  document.getElementById('filterBarRealtime').style.display = (tabId === 'realtime') ? 'flex' : 'none';
  // サマリーバーはリアルタイムタブのみ表示
  document.getElementById('summaryBar').style.display = (tabId === 'realtime') ? 'grid' : 'none';

  // タブボタンのスタイルも更新
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.style.background = '#1e293b';
  });
  document.getElementById(`tab-${tabId}`).style.background = '#3b82f6';

  // データ取得＆描画
  if (tabId === 'past') {
    fetchPastData();
  } else if (tabId === 'realtime') {
    fetchRealtimeData();
  } else if (tabId === 'forecast') {
    fetchForecastData();
  }
}

// ============================
// データ取得＆表示 (過去/みんレポ)
// ============================
async function fetchPastData() {
  setLoading(true);
  try {
    const res = await fetch('/api/high-setting');
    if (activeTab !== 'past') return; // タブが変わっていたら中断
    const data = await res.json();
    currentData.past = data.machines || [];

    // ヘッダーの日付表示を更新（サマリーバーは非表示のまま）
    document.getElementById('dateDisplay').textContent = data.date || '-';

    if (data.scrapeStatus === 'running') {
      updateStatus('running');
      // 取得中でもデータがあれば表示する
      if (currentData.past.length > 0) {
        setLoading(false);
        updateMachineFilter();
        renderPastTable();
      }
      setTimeout(() => { if (activeTab === 'past') fetchPastData(); }, 15000);
      return;
    }

    setLoading(false);
    updateMachineFilter();
    renderPastTable();
    updateStatus('idle');

  } catch (e) {
    console.error('過去データ取得エラー:', e);
    setLoading(false);
    updateStatus('error');
    setTimeout(() => { if (activeTab === 'past') fetchPastData(); }, 30000);
  }
}

// ============================
// データ取得＆表示 (リアルタイム)
// ============================
async function fetchRealtimeData() {
  // 既にデータがあれば画面を消さない（初回のみローディング表示）
  if (currentData.realtime.length === 0) setLoading(true);
  try {
    const res = await fetch('/api/realtime');
    if (activeTab !== 'realtime') return;
    const data = await res.json();

    currentData.realtime = data.machines || [];

    // 最終更新時間を表示
    if (data.timestamp) {
      const t = new Date(data.timestamp);
      const timeStr = `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`;
      document.getElementById('dateDisplay').textContent = `本日 (リアルタイム) | 最終更新: ${timeStr} | ${currentData.realtime.length}台`;
    } else {
      document.getElementById('dateDisplay').textContent = '本日 (リアルタイム) | データ取得ボタンを押してください';
    }
    updateStatus('idle');

    // リアルタイム用の機種フィルタを更新
    const names = [...new Set(currentData.realtime.map(m => m.機種名))].sort();
    const select = document.getElementById('realtimeMachineFilter');
    const currentVal = select.value;
    select.innerHTML = '<option value="all">全機種</option>';
    names.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });
    if (names.includes(currentVal)) select.value = currentVal;

    // サマリーカード更新
    document.getElementById('totalMachines').textContent = currentData.realtime.length;
    const highCount = currentData.realtime.filter(m => m.推定設定 >= 5).length;
    document.getElementById('highSettingCount').textContent = highCount;
    if (data.timestamp) {
      const t = new Date(data.timestamp);
      document.getElementById('lastUpdate').textContent = `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`;
    } else {
      document.getElementById('lastUpdate').textContent = '-';
    }
    updateCountdown();

    setLoading(false);
    if (currentData.realtime.length > 0) {
      renderRealtimeTable();
    } else {
      // データ0件時
      document.getElementById('dataTableRealtime').style.display = 'none';
      const empty = document.getElementById('emptyState');
      const msg = '<div style="text-align:center;padding:40px 20px;">'
        + '<div style="font-size:48px;margin-bottom:16px;">📡</div>'
        + '<div style="font-size:18px;font-weight:bold;margin-bottom:8px;">データ未取得</div>'
        + '<div style="color:#aaa;">「データ取得」ボタンを押して取得を開始してください</div>'
        + '<div style="color:#888;margin-top:8px;font-size:13px;">営業時間中は自動取得も実行されます</div>'
        + '</div>';
      empty.innerHTML = msg;
      empty.style.display = 'block';
    }
  } catch (e) {
    console.error('リアルタイム取得エラー:', e);
    if (activeTab === 'realtime') setLoading(false);
  }
}

// ============================
// データ取得＆表示 (朝一予測)
// ============================
async function fetchForecastData() {
  setLoading(true);
  document.getElementById('dateDisplay').textContent = '朝一推奨 (高信頼度ランキング)';
  try {
    const res = await fetch('/api/forecast');
    if (activeTab !== 'forecast') return; // タブが変わっていたら中断
    const data = await res.json();
    currentData.forecast = data.machines || [];
    setLoading(false);
    renderForecastTable();
  } catch (e) {
    console.error('予測取得エラー:', e);
    if (activeTab === 'forecast') setLoading(false);
  }
}

function setLoading(isLoading) {
  document.getElementById('loading').style.display = isLoading ? 'flex' : 'none';
  if (isLoading) {
    document.getElementById('emptyState').style.display = 'none';
  }
}

function updateCountdown() {
  if (activeTab !== 'realtime') return;
  const now = new Date();
  const h = now.getHours();
  const openHour = 9; // 開店時間
  const closing = new Date(now);
  closing.setHours(22, 40, 0, 0);

  if (h < openHour) {
    // 開店前
    const open = new Date(now);
    open.setHours(openHour, 0, 0, 0);
    const diff = open - now;
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    document.getElementById('timeToClose').textContent = `開店まで ${hrs}h ${mins}m`;
  } else if (now >= closing) {
    document.getElementById('timeToClose').textContent = '閉店';
  } else {
    const diff = closing - now;
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    document.getElementById('timeToClose').textContent = `閉店まで ${hrs}h ${mins}m`;
  }
}

function updateMachineFilter() {
  const names = [...new Set(currentData.past.map(m => m.機種名))].sort();
  const select = document.getElementById('machineFilter');
  const currentVal = select.value;

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
// テーブル描画部
// ============================

// 過去データ描画
function renderPastTable() {
    if (activeTab !== 'past') return;
    const table = document.getElementById('dataTablePast');
    const tbody = document.getElementById('tableBodyPast');
    const empty = document.getElementById('emptyState');
    
    let filtered = [...currentData.past];
    const sortKey = document.getElementById('sortSelect').value;
    const filterMachine = document.getElementById('machineFilter').value;

    if (filterMachine !== 'all') filtered = filtered.filter(m => m.機種名 === filterMachine);

    switch (sortKey) {
        case 'ev': filtered.sort((a, b) => b.期待値円 - a.期待値円); break;
        case 'setting': filtered.sort((a, b) => b.推定設定 - a.推定設定 || b.期待値円 - a.期待値円); break;
        case 'rate': filtered.sort((a, b) => b.出率 - a.出率); break;
        case 'confidence': filtered.sort((a, b) => b.信頼度 - a.信頼度 || b.期待値円 - a.期待値円); break;
        case 'samai': filtered.sort((a, b) => b.差枚 - a.差枚); break;
    }

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
            <td class="td-num td-highlight">${m.期待差枚 ? (m.期待差枚 >= 0 ? '+' : '') + m.期待差枚.toLocaleString() : '-'}</td>
            <td class="td-num td-highlight ${evClass}">${m.期待値円 ? '¥' + m.期待値円.toLocaleString() : '-'}</td>
        </tr>
        `;
    }).join('');
}

// リアルタイム描画
function renderRealtimeTable() {
    if (activeTab !== 'realtime') return;
    const table = document.getElementById('dataTableRealtime');
    const tbody = document.getElementById('tableBodyRealtime');
    const empty = document.getElementById('emptyState');
    
    let filtered = [...currentData.realtime];

    // 設定フィルタ
    const settingFilter = document.getElementById('realtimeSettingFilter').value;
    if (settingFilter === 'high') {
        filtered = filtered.filter(m => m.推定設定 >= 5);
    }

    // 機種フィルタ
    const machineFilter = document.getElementById('realtimeMachineFilter').value;
    if (machineFilter !== 'all') {
        filtered = filtered.filter(m => m.機種名 === machineFilter);
    }

    // ソート
    const sortKey = document.getElementById('realtimeSortSelect').value;
    switch (sortKey) {
        case 'ev': filtered.sort((a, b) => (b.期待値円 || 0) - (a.期待値円 || 0)); break;
        case 'setting': filtered.sort((a, b) => (b.推定設定 || 0) - (a.推定設定 || 0) || (b.期待値円 || 0) - (a.期待値円 || 0)); break;
        case 'prob': filtered.sort((a, b) => (b.G数 || 0) - (a.G数 || 0)); break;
        case 'games': filtered.sort((a, b) => (b.G数 || 0) - (a.G数 || 0)); break;
    }

    // 全機種表示時はTop100に制限（機種選択時は全台表示）
    if (machineFilter === 'all' && filtered.length > 100) {
        filtered = filtered.slice(0, 100);
    }

    if (filtered.length === 0) {
        table.style.display = 'none';
        empty.style.display = 'block';
        return;
    }

    table.style.display = 'table';
    empty.style.display = 'none';

    tbody.innerHTML = filtered.map(m => {
        let settingClass = '';
        let badgeClass = '';
        let badgeText = '';
        if (m.推定設定 === 6) {
            settingClass = 'setting-6'; badgeClass = 'badge-6'; badgeText = '設定6';
        } else if (m.推定設定 === 5) {
            settingClass = 'setting-5'; badgeClass = 'badge-5'; badgeText = '設定5';
        } else if (m.推定設定 === 4) {
            settingClass = ''; badgeClass = ''; badgeText = '設定4';
        } else if (m.推定設定 >= 1) {
            settingClass = ''; badgeClass = ''; badgeText = `設定${m.推定設定}`;
        } else {
            settingClass = ''; badgeClass = ''; badgeText = '-';
        }
        const confClass = m.信頼度スコア >= 80 ? 'confidence-high' : m.信頼度スコア >= 50 ? 'confidence-mid' : 'confidence-low';
        const evClass = (m.期待値円 || 0) >= 0 ? 'td-positive' : 'td-negative';

        return `
        <tr class="${settingClass}">
            <td><span class="badge ${badgeClass}">${badgeText}</span></td>
            <td><span class="confidence ${confClass}">${m.信頼度ラベル || '-'}</span></td>
            <td class="machine-name" title="${m.機種名}">${m.機種名}</td>
            <td>${m.台番}</td>
            <td class="td-num"><strong>${m.実質確率 || '-'}</strong></td>
            <td class="td-num">${m.BB回数 || 0}/${m.RB回数 || 0}/${m.ART回数 || 0}</td>
            <td class="td-num">${m.G数 ? m.G数.toLocaleString() : '0'}</td>
            <td class="td-num">${m.残りG数 ? m.残りG数.toLocaleString() : '-'}</td>
            <td class="td-num td-highlight">${m.期待差枚 ? (m.期待差枚 >= 0 ? '+' : '') + m.期待差枚.toLocaleString() : '-'}</td>
            <td class="td-num td-highlight ${evClass}">${m.期待値円 ? '¥' + m.期待値円.toLocaleString() : '-'}</td>
        </tr>
        `;
    }).join('');
}

// 朝一予測データ描画
function renderForecastTable() {
    if (activeTab !== 'forecast') return;
    const table = document.getElementById('dataTableForecast');
    const tbody = document.getElementById('tableBodyForecast');
    const empty = document.getElementById('emptyState');
    
    if (currentData.forecast.length === 0) {
        table.style.display = 'none';
        empty.style.display = 'block';
        return;
    }

    table.style.display = 'table';
    empty.style.display = 'none';

    tbody.innerHTML = currentData.forecast.map((m, index) => {
        const rankClass = index < 3 ? 'setting-6' : (index < 10 ? 'setting-5' : '');
        let recClass = '';
        if (m.おすすめ度.includes('★★★')) recClass = 'confidence-high';
        else if (m.おすすめ度.includes('★★☆')) recClass = 'confidence-mid';
        else recClass = 'confidence-low';

        return `
        <tr class="${rankClass}">
            <td><span class="confidence ${recClass}">${m.おすすめ度}</span></td>
            <td class="machine-name" title="${m.機種名}">${m.機種名}</td>
            <td><strong>${m.台番}</strong></td>
            <td class="td-num" style="color:#ef4444; font-weight:bold; font-size:1.1em;">${m.高設定回数} 回</td>
            <td class="td-num">${m.平均出率}%</td>
            <td class="td-num ${m.平均差枚 >= 0 ? 'td-positive' : 'td-negative'}">${m.平均差枚.toLocaleString()}</td>
            <td class="td-num" style="color:var(--text-secondary); font-size:0.9em;">${m.直近確認日}</td>
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
    if (activeTab === 'realtime') {
      // リアルタイムタブ: 最新データを再読み込み
      await fetchRealtimeData();
      btn.disabled = false;
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/><polyline points="21 3 21 12 12 12"/></svg> データ取得';
      updateStatus('idle');
    } else {
      // 過去データタブ: みんレポから取得
      await fetch('/api/scrape', { method: 'POST' });
      setTimeout(async () => {
        await loadData();
        btn.disabled = false;
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/><polyline points="21 3 21 12 12 12"/></svg> データ取得';
      }, 15000);
    }
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
    
    // リアルタイム取得用の開始時間 (設定がない場合はデフォルト値を使用)
    if (cfg.realtimeSchedule) {
        document.getElementById('cfgRtStartH').value = cfg.realtimeSchedule.startHour;
        document.getElementById('cfgRtStartM').value = cfg.realtimeSchedule.startMinute;
    }

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
    realtimeSchedule: {
      enabled: document.getElementById('cfgEnabled').checked, // 一旦全体の有効/無効フラグと連動
      startHour: parseInt(document.getElementById('cfgRtStartH').value),
      startMinute: parseInt(document.getElementById('cfgRtStartM').value),
      endHour: 23, // 基本的に夜まで
      endMinute: 30,
      intervalMinutes: parseInt(document.getElementById('cfgInterval').value) // 共通インターバル
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
