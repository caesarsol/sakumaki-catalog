import { COUNTRIES } from "./countries";
import { randomProxy } from "./nordvpn";

// Sonda: Jikan (che rilegge le pagine di MAL) risponde passando da un proxy NordVPN? Dal runner rifiuta la
// connessione. Prova /anime/{id}/statistics, che dà la distribuzione dei voti 1–10. Stampa solo esiti, tempi e forma.
const ids = [16498, 47917, 39533, 40421, 50265];
async function attempt(label: string, proxy?: string) {
  for (const id of ids) {
    const t0 = Date.now();
    try {
      const res = await fetch(`https://api.jikan.moe/v4/anime/${id}/statistics`, { proxy, signal: AbortSignal.timeout(20_000) });
      const body: any = res.ok ? await res.json() : null;
      const scores = body?.data?.scores ?? [];
      console.log(`${label} ${id}: HTTP ${res.status} in ${Date.now() - t0} ms, ${scores.length} fasce${scores[0] ? `, esempio ${JSON.stringify(scores.at(-1))}` : ""}, campi ${Object.keys(body?.data ?? {}).join(",")}`);
    } catch (e) {
      console.log(`${label} ${id}: ${(e as { code?: string }).code ?? (e as Error).name} in ${Date.now() - t0} ms`);
    }
    await Bun.sleep(1200);
  }
}
await attempt("diretto");
for (const iso2 of ["IT", "US"]) {
  const c = COUNTRIES.find((x) => x.iso2 === iso2)!;
  await Bun.sleep(20_000 + Math.random() * 20_000); // login al proxy scaglionati, come nel catalogo
  const proxy = (await randomProxy(c.nordId)).url;
  await attempt(`via proxy ${iso2}`, proxy);
}
