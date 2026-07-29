# Discord学習時間記録Bot

Discord BotとFirebase HostingのWebコンソールは、Supabase PostgreSQLの`activity_intervals`を唯一の学習記録として使います。Firebase Realtime Databaseは、Web画面からBotへ命令を届け、Botが読み取り専用の表示状態を返すためだけに使います。

## 今回の構成

- Bot: Node.js 22 / discord.js v14 / CommonJS
- 正本: Supabase PostgreSQL
- Web認証: Firebase Authentication（Google）
- Web通信: Firebase Realtime Database
- Web公開: Firebase Hosting（`https://tk-f83ff.web.app/`）
- 日時: `Asia/Tokyo`、1日は02:00から翌日02:00まで

同じDiscordユーザーは、サーバーごとに独立して作業できます。作業状態、区間履歴、ランキング、監視、Webデータ、ロックはすべて`guild_id + user_id`で分離されます。

## 追加した主な機能

- `/guild-settings` — 管理者がそのサーバーだけのランキング投稿先と有効状態を設定します。
- サーバー別の常設ランキングメッセージIDと定時ランキング投稿。
- Webコンソールのサーバー選択、guild別の現在状態・タイムライン・統計。
- Web命令ごとのBot側guild所属確認と、`commandId`の重複実行防止。
- `/edit`の科目選択にのみ`削除`を追加し、部分削除・部分置換で前後の履歴を安全に残します。
- Firebase Hostingソース、Realtime Databaseルール、Webタイムライン編集UI。

## 必要な環境変数

Wispbyteの環境変数に設定します。値そのものをGitへ保存しないでください。

```env
TOKEN=Discord Bot Token
CLIENT_ID=Discord Application ID
DATABASE_URL=Supabase PostgreSQL connection string

# Firebase Web Bridgeを使う場合
FIREBASE_PROJECT_ID=tk-f83ff
FIREBASE_DATABASE_URL=https://tk-f83ff-default-rtdb.firebaseio.com
GOOGLE_APPLICATION_CREDENTIALS=/safe/path/firebase-service-account.json
# または FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=...

# 任意
WEB_CONSOLE_URL=https://tk-f83ff.web.app/
PORT=8080
WORK_CONFIRM_AFTER_MINUTES=180
WORK_CONFIRM_GRACE_MINUTES=30
WORK_MONITOR_CRON=* * * * *
```

`GUILD_ID`と`RANKING_CHANNEL_ID`は、旧単一サーバーの移行フォールバックとしてだけ残せます。新しいサーバーの通常運用では設定せず、`/guild-settings`を使ってください。

## データベース移行

既存データを初期化するSQLはありません。新規追加分はすべて再実行可能です。

1. Supabase SQL Editorで、順に次を実行します。

   - `migrations/004_multi_guild_settings.sql`
   - `migrations/005_web_command_receipts.sql`
   - `migrations/006_mutation_guild_scope.sql`

2. 移行前後に`sql/check_legacy_guild_rows.sql`を実行し、`guild_id = ''`の行数を確認します。

3. 旧データを特定サーバーへ安全に割り当てる場合だけ、必ず確認してから実行します。

   ```bash
   node scripts/assign-legacy-guild.js --guild-id <対象DiscordサーバーID>
   node scripts/assign-legacy-guild.js --guild-id <対象DiscordサーバーID> --apply
   ```

   最初のコマンドは変更しません。競合が表示された場合は`--apply`を実行しません。どのサーバーの記録か分からない既存データを一括で割り当てないでください。

## Wispbyteへの反映

Wispbyte上のリポジトリに意図しない変更がないことを確認してから更新します。

```bash
git status
git pull --ff-only
npm ci
node deploy-commands.js
```

続けてWispbyteのBotを再起動します。起動後は次を確認します。

```bash
node --version
ls commands
node -e "const command = require('./commands/web-link.js'); console.log(command.data.name, typeof command.execute)"
```

最後のコマンドは次のように表示されれば正常です。

```text
web-link function
```

`git pull --ff-only`が`package-lock.json`のローカル変更で失敗した場合は、まず`git diff -- package-lock.json`で変更内容を確認します。Wispbyte上の変更が不要と確認できた場合だけ、`git restore package-lock.json`を実行してから再度`git pull --ff-only`してください。通常運用では`npm install`ではなく`npm ci`を使います。

## Discordコマンドとサーバー設定

Botをサーバーへ追加した後、そのサーバーで`Manage Guild`権限を持つ管理者が実行します。

```text
/guild-settings channel:#ランキング投稿先
```

日次・週次・常設ランキングを個別に切り替える場合は、同じコマンドの`daily-enabled`、`weekly-enabled`、`persistent-enabled`を使います。設定未完了のサーバーはランキング機能だけをログ付きでスキップし、Bot全体は動き続けます。

`/edit`は次のオプションです。

```text
subject: 必須（数学、化学、物理、英語、社会、その他、削除）
start: 必須（例: 15:30）
end: 必須（例: 17:00）
date: 任意（例: 7-18、2026-7-18）
task: 任意
```

`/edit`を変更したため、反映時は必ず`node deploy-commands.js`を実行してください。

## Firebase HostingとRealtime Databaseルール

Firebase CLIを使えるPCで、対象プロジェクトを選択して反映します。

```bash
npm install -g firebase-tools
firebase login
firebase use tk-f83ff
firebase deploy --only hosting,database
```

Hostingの公開フォルダは`public/`です。Web側はFirebase Hostingの自動初期化を使うため、Firebase秘密鍵やSupabase接続文字列を`public/`へ置きません。

Firebase ConsoleのAuthenticationでは、Googleログインを有効にし、承認済みドメインに`tk-f83ff.web.app`が含まれることも確認してください。

`database.rules.json`では、ログイン済みユーザーが自分のUID配下の`userData`だけを読め、`commandQueue`には新規の`pending`命令だけを作成できるようにしています。BotのAdmin SDKはルールを越えて結果を更新します。

## Webコンソールの使い方

1. `https://tk-f83ff.web.app/`を開き、Googleでログインします。
2. Discordで`/web-link`を実行します。
3. 表示された`XXXX-XXXX`形式のコードをWebへ入力します。
4. ログイン後に操作するDiscordサーバーを選びます。

サーバー切替時に現在状態、タイムライン、統計が切り替わります。Webから送る開始・一時停止・終了・編集は、Botと同じサービス層とDBロックを使います。

## 確認コマンド

```bash
npm ci
npm run check:syntax
npm test
npm run check:db-schema
node deploy-commands.js
```

本番では次も確認します。

1. 同じユーザーでサーバーAとBに別の作業を開始する。
2. Aを停止してもBが継続する。
3. A/Bの`/today`、`/ranking`、常設ランキングが混ざらない。
4. 各サーバーで`/guild-settings`を設定し、別々の投稿先へ送られる。
5. `/web-link`がすぐに本人だけへ応答し、Webで利用可能なサーバーだけが表示される。
6. Webのサーバー切替、タイムラインの作成・移動・リサイズ・編集・削除を確認する。
7. Bot起動ログにPostgreSQL、コマンド数、Firebase Bridge、ランキング、Activity Monitorが表示される。

## ロールバック

アプリコードはGitの反映コミットを`git revert <commit>`してWispbyteを再起動すれば戻せます。今回のDB移行は追加のみで既存行を削除・一括変換しないため、通常はDBロールバックを行いません。Realtime Databaseルールを戻す必要がある場合は、Firebase Consoleの公開前ルールを保存してから反映してください。

## 秘密情報

`.env`、サービスアカウントJSON、`node_modules/`、`data/`、SQLiteファイルはGit管理しません。サービスアカウントはWispbyteの安全な環境変数またはサーバー外の保護されたパスにのみ置きます。
