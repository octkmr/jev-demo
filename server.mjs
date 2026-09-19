// Jev デモ: プレイグラウンドとチェス。APIキーはサーバー側だけで持つ。
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const PORT = Number(process.env.PORT ?? 3000);
const API_KEY = process.env.TYPESAFE_API_KEY;
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 1024 * 1024;

// ブラウザに返してよい文言だけを持つエラー。詳細はサーバーのログにだけ出す
class HttpError extends Error {
  constructor(status, publicMessage, detail) {
    super(detail ?? publicMessage);
    Object.assign(this, { status, publicMessage });
  }
}

const UPSTREAM_MESSAGES = {
  401: "TypeSafeのAPIキーが無効",
  422: "TypeSafeがリクエストの形式を受け付けなかった",
  429: "TypeSafeが混み合っている。少し待ってからやり直す",
  529: "TypeSafeが混み合っている。少し待ってからやり直す",
};

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "リクエストが大きすぎる");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "リクエストがJSONとして読めない");
  }
}

// チェス: 合法手の列挙と各手の事実はブラウザ側のコードが出し、Jevはその中から1手選ぶ
function chessQuestions(side, moves) {
  return {
    move: {
      type: "choice",
      instructions: `You are playing ${side} in this chess game. Choose the strongest move for ${side} in the current position.`,
      criteria: Object.fromEntries(moves.map(({ uci, ...facts }) => [uci, facts])),
    },
    evaluation: {
      type: "score",
      instructions: "Which side stands better in the current position, considering material, king safety, and threats?",
      criteria: [
        "White is clearly winning",
        "White has a small advantage",
        "The position is roughly balanced",
        "Black has a small advantage",
        "Black is clearly winning",
      ],
    },
  };
}

async function callJev(state, questions) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state, model: "jev-latest", questions }),
  });
  const body = await res.text();
  if (!res.ok) {
    const message = UPSTREAM_MESSAGES[res.status] ?? `TypeSafe APIの呼び出しに失敗した: ${res.status}`;
    throw new HttpError(502, message, `TypeSafe API ${res.status}: ${body}`);
  }
  return JSON.parse(body);
}

function send(res, status, data, type = "application/json") {
  res.writeHead(status, { "Content-Type": type });
  res.end(type === "application/json" ? JSON.stringify(data) : data);
}

createServer(async (req, res) => {
  try {
    // 別のサイトやDNSリバインディング経由でAPIキーを使われないよう、localhost宛てだけ受け付ける
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? "")) return send(res, 403, { error: "forbidden" });
    const page = { "/": "index.html", "/chess": "chess.html" }[req.url];
    if (req.method === "GET" && page) {
      return send(res, 200, await readFile(new URL(`./${page}`, import.meta.url)), "text/html; charset=utf-8");
    }
    if (req.method === "POST" && ["/api/chess", "/api/ask"].includes(req.url)) {
      // application/json 以外を拒否すると、他のサイトからのフォーム送信はプリフライトで止まる
      if (!req.headers["content-type"]?.startsWith("application/json")) return send(res, 415, { error: "Content-Typeはapplication/jsonにする" });
      if (!API_KEY) return send(res, 500, { error: "TYPESAFE_API_KEY が設定されていない" });
      const body = await readJson(req);
      let state, questions;
      if (req.url === "/api/ask") {
        // プレイグラウンド: 画面で組み立てた質問をそのまま送る
        const qs = Object.values(body.questions ?? {});
        if (!qs.length) return send(res, 400, { error: "質問が1つもない" });
        if (qs.some((q) => !["choice", "score", "noul"].includes(q.type))) return send(res, 400, { error: "type は choice, score, noul のどれか" });
        [state, questions] = [body.state, body.questions];
      } else {
        if (!body.moves?.length || body.moves.length > 255) return send(res, 400, { error: "moves は1〜255件" });
        [state, questions] = [body.state, chessQuestions(body.state.jev_plays, body.moves)];
      }
      const started = Date.now();
      const response = await callJev(state, questions);
      // 画面に出すため、送ったリクエスト本文も返す。APIキーは含めない
      const request = { state, model: "jev-latest", questions };
      return send(res, 200, { answers: response.answers, latency_ms: Date.now() - started, request, response });
    }
    send(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    // 読み残した本文があると接続を使い回せないので閉じる
    if (err.status === 413) res.setHeader("Connection", "close");
    if (err instanceof HttpError) return send(res, err.status, { error: err.publicMessage });
    send(res, 500, { error: "サーバー内部でエラーが起きた" });
  }
}).listen(PORT, HOST, () => {
  console.log(`http://localhost:${PORT}`);
  if (!API_KEY) console.warn("TYPESAFE_API_KEY が未設定。判定リクエストはエラーになる");
});
