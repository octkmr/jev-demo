# jev-demo

TypeSafeのJevを試すためのデモ。依存パッケージは無く、Node 24だけで動く。

- `/` プレイグラウンド。入力文と、選択、段階評価、はい・いいえの質問を組み立てて、Jevの答えを確かめる
- `/chess` Jevと対戦するチェス。合法手はコードが出し、Jevはその中から1手を選ぶ

```bash
TYPESAFE_API_KEY=あなたのキー node server.mjs
```

起動したら http://localhost:3000 を開く。APIキーはサーバー側だけで使い、ブラウザには渡さない。
