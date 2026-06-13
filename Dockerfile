FROM ubuntu:24.04

# 基本ツールをインストール
RUN apt-get update && \
    apt-get install -y curl build-essential python3 libsqlite3-dev ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Node.js 22 をインストール
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get update && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依存関係は package*.json を使ってインストール
COPY package*.json ./
RUN npm ci --only=production
# ネイティブモジュールの互換性を確保するため、sqlite3 をソースから再ビルド
RUN npm rebuild sqlite3 --build-from-source || true

# アプリケーションコードをコピー
COPY . .

# 環境変数はホスト/サービス側で管理すること（.env をイメージに含めない）
CMD ["node", "index.js"]
