import { fetchWatchlist, login } from "./api";

const etpRt = Bun.env.AUTH_COOKIE;
if (!etpRt) throw new Error("AUTH_COOKIE mancante: copia il cookie di sessione in .env (vedi .env.example)");

const token = await login(etpRt);
const data = await fetchWatchlist(token);
const out = `${import.meta.dir}/../data/watchlist.json`;
await Bun.write(out, JSON.stringify({ fetched_at: new Date().toISOString(), total: data.length, data }, null, 2));
console.log(`${data.length} titoli salvati in ${out}`);
