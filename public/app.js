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
let availableStores = [];

document.addEventListener('DOMContentLoaded', async () => {
  await loadStores();
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

  // 店舗切り替えイベント
  document.getElementById('hallSelect').addEventListener('change', () => {
    if (activeTab === 'past') fetchPastData();
    else if (activeTab === 'realtime') fetchRealtimeData();
    else if (activeTab === 'forecast') fetchForecastData();
  });
});

async function loadStores() {
  try {
    const res = await fetch('/api/stores');
    availableStores = await res.json();
    const select = document.getElementById('hallSelect');
    select.innerHTML = '';
    availableStores.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      select.appendChild(opt);
    });
  } catch (e) {
    console.error('店舗情報の取得に失敗しました', e);
  }
}

// 店舗ID取得ヘルパー
function getSelectedStoreId() {
  const select = document.getElementById('hallSelect');
  return select ? select.value : 'tachikawa';
}

function getStoreConfig(id) {
  return availableStores.find(s => s.id === id) || null;
}

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
let pastSelectedDate = ''; // 選択中の日付

async function fetchPastData(dateKey) {
  setLoading(true);
  try {
    const storeId = getSelectedStoreId();
    let url = `/api/high-setting?store=${storeId}`;
    if (dateKey) url += `&date=${dateKey}`;
    
    const res = await fetch(url);
    if (activeTab !== 'past') return;
    const data = await res.json();
    currentData.past = data.machines || [];
    pastSelectedDate = data.dateKey || '';

    // 日付・台数・設定5以上台数を表示
    const dateStr = data.date || pastSelectedDate || '-';
    const s5count = currentData.past.filter(m => m.推定設定 >= 5).length;
    document.getElementById('dateDisplay').innerHTML =
      `<span id="pastDateLabel" style="cursor:pointer; border-bottom:2px dashed rgba(255,255,255,0.4); padding-bottom:2px;" onclick="showPastDatePicker()">📅 ${dateStr}</span>` +
      ` | ${currentData.past.length}台 | 設定5以上: <strong style="color:#3b82f6">${s5count}台</strong>`;
    // 日付ピッカー (hidden input)
    if (!document.getElementById('pastDateInput')) {
      const inp = document.createElement('input');
      inp.type = 'date'; inp.id = 'pastDateInput';
      inp.style.cssText = 'position:absolute; opacity:0; pointer-events:none;';
      inp.addEventListener('change', () => { if (inp.value) fetchPastData(inp.value); });
      document.getElementById('dateDisplay').appendChild(inp);
    }

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
    const storeId = getSelectedStoreId();
    const res = await fetch(`/api/realtime?store=${storeId}`);
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
let forecastStartDate = '';
let forecastEndDate = '';

async function fetchForecastData() {
  setLoading(true);
  try {
    const storeId = getSelectedStoreId();
    let url = `/api/forecast?store=${storeId}`;
    const params = [];
    if (forecastStartDate) params.push(`startDate=${forecastStartDate}`);
    if (forecastEndDate) params.push(`endDate=${forecastEndDate}`);
    if (params.length) url += '&' + params.join('&');

    const res = await fetch(url);
    if (activeTab !== 'forecast') return;
    const data = await res.json();
    currentData.forecast = data.machines || [];

    // 期間表示
    const period = data.targetPeriod || '過去30日';
    forecastStartDate = data.startDate || forecastStartDate;
    forecastEndDate = data.endDate || forecastEndDate;
    document.getElementById('dateDisplay').innerHTML =
      `朝一推奨 | <span id="forecastPeriodLabel" style="cursor:pointer; border-bottom:2px dashed rgba(255,255,255,0.4);" onclick="showForecastDatePicker()">📅 ${period}</span>` +
      ` | ${currentData.forecast.length}台`;

    // 期間選択用hidden input
    if (!document.getElementById('forecastStartInput')) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:none;';
      wrap.innerHTML = '<input type="date" id="forecastStartInput"><input type="date" id="forecastEndInput">';
      document.body.appendChild(wrap);
    }

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
        const evClass = (m.期待値円 || 0) >= 0 ? 'td-positive' : 'td-negative';

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
    
    const storeId = getSelectedStoreId();
    const storeCfg = getStoreConfig(storeId);

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
        case 'confidence': filtered.sort((a, b) => (b.信頼度スコア || 0) - (a.信頼度スコア || 0) || (b.期待値円 || 0) - (a.期待値円 || 0)); break;
        case 'prob': filtered.sort((a, b) => {
            const pa = parseFloat((a.実質確率 || '1/9999').split('/')[1]);
            const pb = parseFloat((b.実質確率 || '1/9999').split('/')[1]);
            return pa - pb;
        }); break;
        case 'games': filtered.sort((a, b) => (b.G数 || 0) - (a.G数 || 0)); break;
    }

    // 全台表示（制限なし）

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
            <td class="machine-name" title="${m.機種名}">
                <a href="https://www.d-deltanet.com/pc/D0301.do?pmc=${storeCfg ? storeCfg.ddelta.pmc : '22021030'}&clc=${storeCfg ? storeCfg.ddelta.clc : '03'}&urt=${storeCfg ? storeCfg.ddelta.urt : '2173'}&pan=1" target="_blank" rel="noopener" style="color:var(--text-primary); text-decoration:underline;">${m.機種名}</a>
            </td>
            <td>${m.台番}</td>
            <td class="td-num">
                <strong>${m.実質確率 || '-'}</strong><br>
                <span style="font-size:10px; color:var(--text-secondary);">${m.計算方式 ? '(' + m.計算方式 + ')' : ''}</span>
            </td>
            <td class="td-num ${m.最高出玉 >= 0 ? 'td-positive' : 'td-negative'}">${m.最高出玉 ? m.最高出玉.toLocaleString() : '-'}</td>
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
        if (m.おすすめ度 && m.おすすめ度.includes('★★★')) recClass = 'confidence-high';
        else if (m.おすすめ度 && m.おすすめ度.includes('★★☆')) recClass = 'confidence-mid';
        else recClass = 'confidence-low';

        return `
        <tr class="${rankClass}" style="cursor:pointer;" onclick="showMachineDetail('${m.台番}', '${m.機種名.replace(/'/g, "\\'")}')"
            title="クリックで詳細表示">
            <td><span class="confidence ${recClass}">${m.おすすめ度 || '-'}</span></td>
            <td class="machine-name" title="${m.機種名}">${m.機種名}</td>
            <td><strong>${m.台番}</strong></td>
            <td class="td-num" style="color:#ef4444; font-weight:bold; font-size:1.1em;">${m.設定6回数 || 0}</td>
            <td class="td-num" style="color:#f59e0b; font-weight:bold;">${m.設定5回数 || 0}</td>
            <td class="td-num" style="font-weight:bold;">${m.高設定合計 || 0}</td>
            <td class="td-num">${m.平均出率 || '-'}%</td>
            <td class="td-num" style="color:var(--text-secondary); font-size:0.9em;">${m.直近確認日 || '-'}</td>
        </tr>
        `;
    }).join('');
}

// ============================
// 朝一予測: 期間選択
// ============================
function showForecastDatePicker() {
    // 簡易ダイアログで期間選択
    const modal = document.createElement('div');
    modal.id = 'forecastDateModal';
    modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:1000; display:flex; align-items:center; justify-content:center;';
    modal.innerHTML = `
        <div style="background:var(--bg-card); border:1px solid var(--border); border-radius:12px; padding:24px; width:320px; max-width:90vw;">
            <h3 style="margin-bottom:16px; font-size:16px;">📅 期間指定</h3>
            <div style="margin-bottom:12px;">
                <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:4px;">開始日</label>
                <input type="date" id="fDateStart" value="${forecastStartDate}" style="width:100%; padding:8px; background:var(--bg-secondary); border:1px solid var(--border); border-radius:6px; color:var(--text-primary); font-size:14px;">
            </div>
            <div style="margin-bottom:16px;">
                <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:4px;">終了日</label>
                <input type="date" id="fDateEnd" value="${forecastEndDate}" style="width:100%; padding:8px; background:var(--bg-secondary); border:1px solid var(--border); border-radius:6px; color:var(--text-primary); font-size:14px;">
            </div>
            <div style="display:flex; gap:8px; justify-content:flex-end;">
                <button onclick="document.getElementById('forecastDateModal').remove()" style="padding:8px 16px; background:transparent; border:1px solid var(--border); border-radius:6px; color:var(--text-secondary); cursor:pointer;">キャンセル</button>
                <button onclick="applyForecastDate()" style="padding:8px 16px; background:var(--accent); border:none; border-radius:6px; color:white; cursor:pointer; font-weight:bold;">適用</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

function applyForecastDate() {
    forecastStartDate = document.getElementById('fDateStart').value;
    forecastEndDate = document.getElementById('fDateEnd').value;
    document.getElementById('forecastDateModal').remove();
    fetchForecastData();
}

// ============================
// 朝一予測: 台番詳細モーダル
// ============================
async function showMachineDetail(machineNo, machineName) {
    const modal = document.createElement('div');
    modal.id = 'machineDetailModal';
    modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:1000; display:flex; align-items:center; justify-content:center;';
    modal.innerHTML = `
        <div style="background:var(--bg-card); border:1px solid var(--border); border-radius:12px; padding:24px; width:500px; max-width:95vw; max-height:80vh; overflow-y:auto;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <h3 style="font-size:16px;">📊 台番 ${machineNo} 詳細 (${machineName})</h3>
                <button onclick="document.getElementById('machineDetailModal').remove()" style="background:none; border:none; color:var(--text-secondary); cursor:pointer; font-size:20px;">✕</button>
            </div>
            <div id="machineDetailContent" style="text-align:center; padding:20px; color:var(--text-secondary);">
                <div class="spinner" style="margin:0 auto 8px;"></div>
                読み込み中...
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    try {
        const storeId = getSelectedStoreId();
        const params = [`store=${storeId}`, `machineNo=${machineNo}`];
        if (forecastStartDate) params.push(`startDate=${forecastStartDate}`);
        if (forecastEndDate) params.push(`endDate=${forecastEndDate}`);
        const res = await fetch(`/api/machine-history?${params.join('&')}`);
        const data = await res.json();

        if (!data.history || data.history.length === 0) {
            document.getElementById('machineDetailContent').innerHTML = '<p>指定期間のデータがありません</p>';
            return;
        }

        let html = `
            <div style="display:flex; gap:16px; margin-bottom:16px; justify-content:center;">
                <div style="text-align:center; padding:12px 20px; background:var(--bg-secondary); border-radius:8px;">
                    <div style="font-size:24px; font-weight:bold; color:#ef4444;">${data.s6count}</div>
                    <div style="font-size:11px; color:var(--text-secondary);">⑥回数</div>
                </div>
                <div style="text-align:center; padding:12px 20px; background:var(--bg-secondary); border-radius:8px;">
                    <div style="font-size:24px; font-weight:bold; color:#f59e0b;">${data.s5count}</div>
                    <div style="font-size:11px; color:var(--text-secondary);">⑤回数</div>
                </div>
                <div style="text-align:center; padding:12px 20px; background:var(--bg-secondary); border-radius:8px;">
                    <div style="font-size:24px; font-weight:bold; color:var(--accent);">${data.history.length}</div>
                    <div style="font-size:11px; color:var(--text-secondary);">総日数</div>
                </div>
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:13px;">
                <thead>
                    <tr style="background:var(--bg-secondary);">
                        <th style="padding:8px; text-align:left; border-bottom:1px solid var(--border); color:var(--text-secondary); font-size:11px;">日付</th>
                        <th style="padding:8px; text-align:center; border-bottom:1px solid var(--border); color:var(--text-secondary); font-size:11px;">設定</th>
                        <th style="padding:8px; text-align:right; border-bottom:1px solid var(--border); color:var(--text-secondary); font-size:11px;">出率</th>
                        <th style="padding:8px; text-align:right; border-bottom:1px solid var(--border); color:var(--text-secondary); font-size:11px;">差枚</th>
                        <th style="padding:8px; text-align:right; border-bottom:1px solid var(--border); color:var(--text-secondary); font-size:11px;">G数</th>
                    </tr>
                </thead>
                <tbody>
        `;
        // 日付が新しい順にソート (YYYY-MM-DD 形式を想定)
        const sortedHistory = [...data.history].sort((a, b) => new Date(b.日付) - new Date(a.日付));

        for (const h of sortedHistory) {
            const bgColor = h.推定設定 === '⑥' ? 'rgba(251,191,36,0.15)'
                         : h.推定設定 === '⑤' ? 'rgba(99,102,241,0.12)' : 'transparent';
            const settingColor = h.推定設定 === '⑥' ? '#fbbf24'
                              : h.推定設定 === '⑤' ? '#818cf8' : 'var(--text-muted)';
            const samaiColor = (h.差枚 || 0) >= 0 ? 'var(--green)' : 'var(--red)';
            html += `
                <tr style="background:${bgColor}; border-bottom:1px solid rgba(46,51,72,0.3);">
                    <td style="padding:8px;">${h.日付}</td>
                    <td style="padding:8px; text-align:center; font-weight:bold; color:${settingColor}; font-size:1.1em;">${h.推定設定}</td>
                    <td style="padding:8px; text-align:right;">${h.出率 ? h.出率.toFixed(1) + '%' : '-'}</td>
                    <td style="padding:8px; text-align:right; color:${samaiColor};">${h.差枚 ? h.差枚.toLocaleString() : '-'}</td>
                    <td style="padding:8px; text-align:right;">${h.G数 ? h.G数.toLocaleString() : '-'}</td>
                </tr>
            `;
        }
        html += '</tbody></table>';
        document.getElementById('machineDetailContent').innerHTML = html;
    } catch (e) {
        document.getElementById('machineDetailContent').innerHTML = `<p style="color:var(--red);">エラー: ${e.message}</p>`;
    }
}


// ============================
// 日付選択 (過去データ)
// ============================
function showPastDatePicker() {
    const inp = document.getElementById('pastDateInput');
    if (inp) {
        inp.style.pointerEvents = 'auto';
        inp.showPicker ? inp.showPicker() : inp.click();
        setTimeout(() => { inp.style.pointerEvents = 'none'; }, 100);
    }
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
    
    // リアルタイム取得用の設定
    if (cfg.realtimeSchedule) {
        document.getElementById('cfgRtStartH').value = cfg.realtimeSchedule.startHour;
        document.getElementById('cfgRtStartM').value = cfg.realtimeSchedule.startMinute;
        document.getElementById('cfgRtEndH').value = cfg.realtimeSchedule.endHour || 22;
        document.getElementById('cfgRtEndM').value = cfg.realtimeSchedule.endMinute || 30;
        document.getElementById('cfgRtInterval').value = cfg.realtimeSchedule.intervalMinutes || 30;
    }

    document.getElementById('cfgInterval').value = cfg.schedule.intervalMinutes;
    document.getElementById('cfgCloseH').value = cfg.closingTime.hour;
    document.getElementById('cfgCloseM').value = cfg.closingTime.minute;
    document.getElementById('cfgMinGames').value = cfg.analysis.minGames;
    document.getElementById('cfgSecPerGame').value = cfg.analysis.secondsPerGame;

    // フッタースケジュール表示
    if (cfg.schedule.enabled) {
      const rtInfo = cfg.realtimeSchedule ? ` | RT: ${cfg.realtimeSchedule.startHour}:${String(cfg.realtimeSchedule.startMinute || 0).padStart(2, '0')}〜${cfg.realtimeSchedule.endHour || 22}:${String(cfg.realtimeSchedule.endMinute || 30).padStart(2, '0')} / ${cfg.realtimeSchedule.intervalMinutes || 30}分` : '';
      document.getElementById('footerSchedule').textContent =
        `みんレポ: ${cfg.schedule.startHour}:${String(cfg.schedule.startMinute).padStart(2, '0')}〜${cfg.schedule.endHour}:${String(cfg.schedule.endMinute).padStart(2, '0')} / ${cfg.schedule.intervalMinutes}分${rtInfo}`;
    } else {
      document.getElementById('footerSchedule').textContent = '無効';
    }
  } catch (e) {
    console.error('設定取得エラー:', e);
  }
}

async function saveConfig() {
  try {
    // 現在のconfig.jsonを取得して、UI入力値だけ上書きする（storesなど消さないため）
    const currentRes = await fetch('/api/config');
    const cfg = await currentRes.json();

    cfg.schedule = {
      enabled: document.getElementById('cfgEnabled').checked,
      startHour: parseInt(document.getElementById('cfgStartH').value),
      startMinute: parseInt(document.getElementById('cfgStartM').value),
      endHour: parseInt(document.getElementById('cfgEndH').value),
      endMinute: parseInt(document.getElementById('cfgEndM').value),
      intervalMinutes: parseInt(document.getElementById('cfgInterval').value)
    };
    cfg.realtimeSchedule = {
      enabled: document.getElementById('cfgEnabled').checked,
      startHour: parseInt(document.getElementById('cfgRtStartH').value),
      startMinute: parseInt(document.getElementById('cfgRtStartM').value),
      endHour: parseInt(document.getElementById('cfgRtEndH').value),
      endMinute: parseInt(document.getElementById('cfgRtEndM').value),
      intervalMinutes: parseInt(document.getElementById('cfgRtInterval').value)
    };
    cfg.closingTime = {
      hour: parseInt(document.getElementById('cfgCloseH').value),
      minute: parseInt(document.getElementById('cfgCloseM').value)
    };
    cfg.analysis = {
      minGames: parseInt(document.getElementById('cfgMinGames').value),
      secondsPerGame: parseFloat(document.getElementById('cfgSecPerGame').value),
      coinRate: 46,
      inPerGame: 3
    };

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
