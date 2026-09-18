import { fetchCatalog, login } from "./api";

const etpRt = Bun.env.AUTH_COOKIE;
if (!etpRt) throw new Error("AUTH_COOKIE mancante: copia il cookie di sessione in .env (vedi .env.example)");

const token = await login(etpRt);
const series = await fetchCatalog(token);
const out = `${import.meta.dir}/../data/catalog.ndjson`;
await Bun.write(out, series.map((s) => JSON.stringify(s)).join("\n") + "\n");
console.log(`${series.length} serie salvate in ${out}`);
