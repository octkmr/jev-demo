// ローカル用のサーバー。Vercel上では public/ の静的配信と api/ の関数が同じ役割をする
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { handleJevRequest, send } from "./lib/jev.mjs";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = "127.0.0.1";
const PAGES = { "/": "index.html", "/chess": "chess.html" };
const ROUTES = { "/api/ask": "ask", "/api/chess": "chess" };

createServer(async (req, res) => {
  try {
    // 別のサイトやDNSリバインディング経由でAPIキーを使われないよう、localhost宛てだけ受け付ける
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? "")) return send(res, 403, { error: "forbidden" });
    const page = PAGES[req.url];
    if (req.method === "GET" && page) {
      return send(res, 200, await readFile(new URL(`./public/${page}`, import.meta.url)), "text/html; charset=utf-8");
    }
    const kind = ROUTES[req.url];
    if (kind) return await handleJevRequest(req, res, kind);
    send(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: "サーバー内部でエラーが起きた" });
  }
}).listen(PORT, HOST, () => {
  console.log(`http://localhost:${PORT}`);
  if (!process.env.TYPESAFE_API_KEY) console.warn("TYPESAFE_API_KEY が未設定。判定リクエストはエラーになる");
});
