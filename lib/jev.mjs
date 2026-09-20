// Jevへの問い合わせ。APIキーはこのモジュールの中だけで読み、リクエストにもレスポンスにも載せない
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MAX_BODY_BYTES = 1024 * 1024;

// ブラウザに返してよい文言だけを持つエラー。詳細はサーバーのログにだけ出す
export class HttpError extends Error {
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

export function send(res, status, data, type = "application/json") {
  res.writeHead(status, { "Content-Type": type });
  res.end(type === "application/json" ? JSON.stringify(data) : data);
}

// 他のサイトの画面からAPIキーを使われないようにする。Originが無いリクエスト(curlなど)は
// ヘッダでは区別できないので、公開時はVercelのDeployment Protectionで front に蓋をする
function crossSite(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  // x-forwarded-host はカンマ区切りや配列で複数入ることがあるので、単純な比較では誤って弾く
  const forwarded = req.headers["x-forwarded-host"] ?? "";
  const hosts = [
    ...(Array.isArray(forwarded) ? forwarded : forwarded.split(",")),
    req.headers.host,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
  ]
    .map((host) => host?.trim())
    .filter(Boolean);
  try {
    return !hosts.includes(new URL(origin).host);
  } catch {
    return true;
  }
}

async function readJson(req) {
  // Vercelのランタイムは application/json を先に読んで req.body に入れる
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      throw new HttpError(400, "リクエストがJSONとして読めない");
    }
  }
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
export function chessQuestions(side, moves) {
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
    headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state, model: "jev-latest", questions }),
  });
  const body = await res.text();
  if (!res.ok) {
    const message = UPSTREAM_MESSAGES[res.status] ?? `TypeSafe APIの呼び出しに失敗した: ${res.status}`;
    throw new HttpError(502, message, `TypeSafe API ${res.status}: ${body}`);
  }
  return JSON.parse(body);
}

// 画面で組み立てた質問をそのまま送る
function askPayload(body) {
  const qs = Object.values(body.questions ?? {});
  if (!qs.length) throw new HttpError(400, "質問が1つもない");
  if (qs.some((q) => !["choice", "score", "noul"].includes(q.type))) throw new HttpError(400, "type は choice, score, noul のどれか");
  return [body.state, body.questions];
}

function chessPayload(body) {
  if (!body.moves?.length || body.moves.length > 255) throw new HttpError(400, "moves は1〜255件");
  return [body.state, chessQuestions(body.state.jev_plays, body.moves)];
}

const PAYLOADS = { ask: askPayload, chess: chessPayload };

// /api/ask と /api/chess の中身。Vercelの関数からもローカルのserver.mjsからも同じものを使う
export async function handleJevRequest(req, res, kind) {
  try {
    if (req.method !== "POST") return send(res, 405, { error: "POSTだけ受け付ける" });
    if (crossSite(req)) return send(res, 403, { error: "forbidden" });
    // application/json 以外を拒否すると、他のサイトからのフォーム送信はプリフライトで止まる
    if (!req.headers["content-type"]?.startsWith("application/json")) return send(res, 415, { error: "Content-Typeはapplication/jsonにする" });
    if (!process.env.TYPESAFE_API_KEY) return send(res, 500, { error: "TYPESAFE_API_KEY が設定されていない" });
    const [state, questions] = PAYLOADS[kind](await readJson(req));
    const started = Date.now();
    const response = await callJev(state, questions);
    // 画面に出すため、送ったリクエスト本文も返す。APIキーは含めない
    const request = { state, model: "jev-latest", questions };
    return send(res, 200, { answers: response.answers, latency_ms: Date.now() - started, request, response });
  } catch (err) {
    console.error(err);
    // 読み残した本文があると接続を使い回せないので閉じる
    if (err.status === 413) res.setHeader("Connection", "close");
    if (err instanceof HttpError) return send(res, err.status, { error: err.publicMessage });
    send(res, 500, { error: "サーバー内部でエラーが起きた" });
  }
}
