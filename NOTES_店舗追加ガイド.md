# 楽園立川スロットアナライザー — 乗り越えた課題と店舗追加ガイド

## アーキテクチャ概要

```
[みんレポ (min-repo.com)]  →  scraper.js  →  MongoDB (Machine)  →  過去データ/朝一予測
[d-deltanet.com]           →  scraper_ddelta.js  →  MongoDB (RealtimeCache)  →  リアルタイム
```

- **サーバー**: Render (Node.js + Express)
- **DB**: MongoDB Atlas
- **過去データ**: みんレポからスクレイプ → MongoDBにUpsert
- **リアルタイム**: d-deltanetからHTTP GETでスクレイプ → MongoDBキャッシュ
- **朝一予測**: 過去30日のMongoDBデータ + 機種別理論出率で設定⑤⑥判定

---

## 乗り越えた課題一覧

### 1. d-deltanetのセッションCookie問題
**問題**: 機種データページ (D3301.do) にアクセスしてもエラーページが返る。
**原因**: d-deltanetはセッション管理が厳格。適切なCookie (`JSESSIONID`) とアクセス順序が必須。
**解決策**:
- トップページ → Cookie承諾 → ポータル → 機種詳細 → D3301.do の順序でアクセス
- `Referer` ヘッダーを適切に設定
- `set-cookie` レスポンスヘッダーを全て保持・送信

### 2. d-deltanetのレートリミット
**問題**: 78機種を高速にリクエストすると「混み合っています」エラー (462バイト)。
**解決策**:
- 機種間リクエスト間隔を **2〜3秒** に設定
- D3301.doリクエスト前に **1秒** 待機
- エラーレスポンス検出時に **5秒** リトライ

### 3. クラウドIPからのアクセス制限 (403/タイムアウト)
**問題**: RenderなどのクラウドサーバーIPからd-deltanetにアクセスするとタイムアウトまたは403。
**解決策**:
- リアルタイムデータは **ローカルPCのCLIスクリプト** (`scrape_realtime_cli.js`) で取得
- 取得データを **MongoDB** 経由でRenderサーバーに共有
- GitHub Actionsでの自動取得は断念（Actionsもクラウド）

### 4. Shift_JIS → UTF-8 デコード
**問題**: d-deltanetのHTMLはShift_JISエンコード。日本語が文字化け。
**解決策**: `iconv-lite` パッケージで Shift_JIS → UTF-8 変換。

### 5. HTMLテーブル解析の複雑さ
**問題**: D3301.doのテーブルセル内に `<a>` タグがあり、単純な `<td>` テキスト抽出だと失敗。
**解決策**: HTMLタグ除去方式 (`replace(/<[^>]+>/g, '')`) でセル内テキストを確実に抽出。

### 6. 営業時間外データの扱い
**問題**: 営業時間外はG数=0、差枚=0、出率="--" でデータが表示される。スクレイパーがこれを除外していた。
**解決策**: G数=0でもデータを保持する。ただし設定推定は0 (不明) として扱う。

### 7. 5円スロットの除外
**問題**: みんレポの過去データには貸し単価情報がない。同じ機種名が5円と46円の両方に存在し得る。
**解決策**:
- **台番号ホワイトリスト方式**: d-deltanetの46円ポータルから取得した台番号 = 46円の台
- `scrapeDDelta()` 実行時に `slot46_numbers.json` を自動生成
- 過去データAPI・朝一予測APIでホワイトリストに含まれる台番のみ表示
- ファイルが存在しない場合はフィルタなし (全件表示)

### 8. 朝一予測の出率ベース問題
**問題**: 出率107.5%以上の固定閾値では、Aタイプ高設定 (出率105%程度でも設定⑥) を見落とす。
**解決策**:
- `machine_db.json` の機種ごとの理論出率 (s1〜s6) で個別に判定
- 設定⑥濃厚回数 + 設定⑤以上回数を別カウント
- ソート: ⑥回数 → ⑤⑥合計 → 平均出率

---

## 新店舗追加時の手順

### 1. d-deltanetのポータルURL特定
- `https://www.d-deltanet.com/pc/D0301.do` にアクセス
- パラメータ `pmc=XXXXXXX` (店舗コード), `clc=03` (カテゴリ), `urt=XXXX` (ユニークID)
- 46円スロットと5円スロットで別のポータルURLがある

### 2. scraper_ddelta.jsの修正
```javascript
// BASE_URLとポータルURLを店舗ごとに設定可能にする
const PORTAL_URL = `D0301.do?pmc=${PMC}&clc=03&urt=${URT}&pan=`;
```

### 3. scraper.jsの修正 (みんレポ)
```javascript
// config.jsonのstoreTagを変更
"storeTag": "楽園○○店"
```

### 4. config.json更新
- `scrape.storeTag` を対象店舗名に変更
- `closingTime` を店舗の閉店時間に合わせる

### 5. machine_db.jsonの更新
- 新店舗に固有の機種があれば追加
- `machine_lookup.js` の自動検索で概ね対応可能

---

## 重要な設定・環境変数

| 変数名 | 用途 | 例 |
|--------|------|-----|
| `MONGODB_URI` | MongoDB接続 | `mongodb+srv://...` |
| `DISABLE_SCRAPING` | サーバー上のスクレイプ無効化 | `true` |
| `PORT` | サーバーポート | `3000` |

---

## ファイル構成

| ファイル | 役割 |
|---------|------|
| `server.js` | Express API + 定期スクレイプ |
| `scraper.js` | みんレポ スクレイパー |
| `scraper_ddelta.js` | d-deltanet スクレイパー (リアルタイム) |
| `analyzer.js` | 設定判別 + 期待値計算 |
| `machine_lookup.js` | 機種別理論出率 自動取得 |
| `machine_db.json` | 機種別理論出率DB |
| `database.js` | MongoDB接続 + Mongooseモデル |
| `config.json` | 取得スケジュール・閾値設定 |
| `slot46_numbers.json` | 46円台番号ホワイトリスト (自動生成) |
| `scrape_realtime_cli.js` | ローカルPC用リアルタイム取得スクリプト |
| `public/app.js` | フロントエンド ロジック |
| `public/index.html` | フロントエンド HTML |
| `public/style.css` | フロントエンド CSS |
