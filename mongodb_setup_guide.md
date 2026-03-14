# 🚀 MongoDB Atlas & Render 連携手順

プログラム側の改修（MongoDB対応）が完了しました！
次はご自身の環境で、無料のデータベース（MongoDB Atlas）を作成し、プログラムと繋ぐ作業を行います。

---

## ステップ 1: MongoDB Atlas の登録と作成

1. **[MongoDB Atlas](https://www.mongodb.com/ja-jp/cloud/atlas/register)** にアクセスし、無料アカウントを作成します（Googleアカウントでも登録可能です）。
2. アンケート画面が出たら適当に答えて進めます。
3. **「Deploy a cloud database」**（またはクラスタの作成画面）が表示されたら：
   - 料金プラン: **「M0 Free」**（無料枠）を選択
   - Provider: **AWS** または **Google Cloud** を選択
   - Region: **Tokyo (ap-northeast-1)** を選択
   - Name: 初期値の「Cluster0」のままでOK
   - **「Create」** ボタンを押します。

## ステップ 2: 接続パスワードとIP許可の設定

クラスタが作成されると「Security Quickstart」画面が出ます。

1. **How would you like to authenticate your connection?**
   - Username and Password を選択
   - **Username**: `admin` などわかりやすい名前を入力
   - **Password**: 任意のパスワードを入力（**後で使うので必ずメモしてください！**）
   - 「Create User」を押します。
2. **Where would you like to connect from?**
   - My Local Environment を選択
   - IP Address: `0.0.0.0/0` と入力し、Descriptionに `Allow All` と入力（どこからでも接続可能にするため）
   - 「Add Entry」を押します。
3. 一番下の「Finish and Close」を押して、「Go to Databases」を押します。

## ステップ 3: 接続URL (Connection String) の取得

1. 「Database」画面で、作成したクラスタにある **「Connect」** ボタンを押します。
2. 「Connect to your application」枠の **「Drivers」** を選びます。
3. 画面下部に `mongodb+srv://...` から始まる長いURLが表示されるので、それをコピーします。

## ステップ 4: プログラムへの設定とデータ移行

1. コピーしたURLの中の `<password>` の部分を、**ステップ2で決めたパスワード**に書き直します。
   （例: `mongodb+srv://admin:myPassword123@cluster0.xxx.mongodb.net/?retryWrites=true&w=majority`）
2. プログラムのフォルダにある `.env.sample` ファイルをコピーして、名前を `.env`（ドットから始まる環境変数ファイル）に変更し、上記URLを貼り付けて保存します。

```env
MONGODB_URI=mongodb+srv://admin:コピーしたパスワード@cluster0.xxx.mongodb.net/?retryWrites=true&w=majority
```

3. コマンドプロンプトでプログラムのフォルダに移動し、**以下のコマンドを実行して過去データをコピー**します！

```bash
node migrate_to_mongo.js
```

これで過去のデータがすべて MongoDB に入り、以降のスクレイピング結果もMongoDBに保存されるようになります！

**ここまで完了しましたら、教えてください！**
（最後に、GitHubへのアップロードとRenderでの公開手順をご案内します）
