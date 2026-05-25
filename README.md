# BreachOps

Flask + Docker で動く静的ファイルサーバー。Render にデプロイされています。

---

## Render でのデバッグ方法

### 1. ログを確認する

Render ダッシュボードの **Logs** タブでリアルタイムのログを確認できます。

- `gunicorn` のアクセスログ・エラーログがここに出力されます
- デプロイ時のビルドログも確認できます（**Events** タブ）

アプリ側でログを増やしたい場合は `app.py` に以下を追加します:

```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

---

### 2. ヘルスチェックエンドポイントで死活確認

```
GET /health
```

レスポンス例:

```json
{ "status": "ok" }
```

`render.yaml` の `healthCheckPath: /health` により、Render はデプロイ後にこのエンドポイントで起動確認をします。ここが 200 を返さないとデプロイ失敗になります。

---

### 3. ローカルで Docker ビルドを再現する

Render 上と同じ環境をローカルで再現できます。

```bash
# イメージをビルド
docker build -t breachops .

# コンテナを起動（ポート 10000 で確認）
docker run -p 10000:10000 breachops
```

ブラウザで `http://localhost:10000` を開いて動作確認します。

エラーがあればターミナルにそのまま出力されます。

---

### 4. ローカルで Flask を直接起動する（Docker なし）

```bash
pip install -r requirements.txt
python app.py
```

`http://localhost:3000` で確認できます。コードを変更するたびに自動で再起動させたい場合:

```bash
FLASK_DEBUG=1 python app.py
```

---

### 5. Render のシェルで直接調査する（Shell タブ）

Render の有料プランでは **Shell** タブからコンテナに直接 SSH できます。

```bash
# ファイルの存在確認
ls /app/public/

# プロセス確認
ps aux

# 環境変数確認
env | grep PORT
```

---

### 6. 環境変数を確認する

Render ダッシュボードの **Environment** タブで環境変数を設定・確認できます。

`app.py` では `PORT` 環境変数を参照しています:

```python
port = int(os.environ.get('PORT', 3000))
```

Render 本番では `PORT=10000`（Dockerfile の `ENV PORT=10000`）が使われます。

---

### 7. よくあるエラーと対処

| 症状 | 原因 | 対処 |
|------|------|------|
| デプロイが `Deploy failed` になる | ヘルスチェック (`/health`) がタイムアウト | Logs タブでビルドエラーを確認 |
| 静的ファイルが 404 になる | `public/` にファイルがない | `ls /app/public/` で確認 |
| コンテナが起動直後に落ちる | `gunicorn` の起動エラー | Logs タブの `Error` 行を確認 |
| 環境変数が反映されない | Render 側の設定ミス | Environment タブを再確認して Manual Deploy |
