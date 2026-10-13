import { boot, route } from "../server.mjs";

let booted = false;

export default async function handler(req, res) {
  if (!booted) {
    await boot();
    booted = true;
  }
  return route(req, res).catch((e) => {
    res.writeHead(e.status ?? 500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  });
}
