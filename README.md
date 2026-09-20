# jev-demo

TypeSafeのJevを試すためのデモ。依存パッケージは無く、Nodeだけで動く。

- `/` プレイグラウンド。入力文と、選択、段階評価、はい・いいえの質問を組み立てて、Jevの答えを確かめる
- `/chess` Jevと対戦するチェス。合法手はコードが出し、Jevはその中から1手を選ぶ

## 構成

| パス | 役割 |
| --- | --- |
| `public/` | 画面。Vercelではそのまま静的配信される |
| `api/ask.mjs`, `api/chess.mjs` | 判定リクエストの受け口。Vercelでは1つずつの関数になる |
| `lib/jev.mjs` | Jevの呼び出しと入力チェック。APIキーはここだけで読む |
| `server.mjs` | ローカル用のサーバー。上の2つを繋いで1プロセスで出す |

## ローカルで動かす

```bash
TYPESAFE_API_KEY=あなたのキー node server.mjs
```

起動したら http://localhost:3000 を開く。APIキーはサーバー側だけで使い、ブラウザには渡さない。

`vercel dev` でもよい。その場合は `vercel env pull` でキーを `.env.local` に落としておく。

## Vercelに上げる

1. [vercel.com/new](https://vercel.com/new) でこのリポジトリをImportする。Framework Presetは **Other**、ビルド設定は触らなくてよい（依存もビルドも無い）
2. Settings → Environment Variables で `TYPESAFE_API_KEY` を Production / Preview / Development に追加する
3. Deployする

CLIだけで済ませるなら:

```bash
npm i -g vercel
vercel link
vercel env add TYPESAFE_API_KEY
vercel --prod
```

`vercel.json` では、`/chess.html` を `/chess` に寄せる `cleanUrls` と、Jevの応答を待てるように関数の `maxDuration` を60秒にしている。

### 公開するときの注意

APIキーはサーバー側にしか無いが、**URLを知っている人は誰でもあなたのキーでJevを叩ける**。
`lib/jev.mjs` の `Origin` 判定は他のサイトの画面から使われるのを止めるだけで、`curl`は止められない。
デモとして出すなら Settings → Deployment Protection で Vercel Authentication かパスワードを有効にして、
入口ごと閉じておく。
