import type { WatchlistItem } from "./api";

/**
 * Elenca i campi che l'API mette davvero in ogni voce di watchlist, con un valore d'esempio.
 * I tipi in api.ts ne dichiarano solo una parte (hanno un index signature): questo dice cosa c'è
 * davvero nei tuoi dati, senza chiamare l'API — legge data/watchlist.json già scaricato.
 */
const dataDir = `${import.meta.dir}/../data`;
const { data }: { data: WatchlistItem[] } = await Bun.file(`${dataDir}/watchlist.json`).json();

const short = (v: unknown) => {
  const s = typeof v === "object" && v !== null ? `{${Object.keys(v).join(", ")}}` : JSON.stringify(v);
  return s && s.length > 70 ? s.slice(0, 67) + "…" : s;
};
const dump = (label: string, objects: unknown[]) => {
  const keys = new Map<string, unknown>();
  for (const o of objects) for (const [k, v] of Object.entries(o as object)) if (!keys.has(k) || keys.get(k) == null) keys.set(k, v);
  console.log(`\n${label} (${objects.length} campioni, ${keys.size} campi)`);
  for (const [k, v] of [...keys].sort()) console.log(`  ${k.padEnd(28)} ${typeof v === "object" && v !== null ? "" : typeof v} ${short(v)}`);
};

dump("voce di watchlist", data);
dump("voce.panel", data.map((w) => w.panel));
dump("voce.panel.episode_metadata", data.map((w) => w.panel.episode_metadata).filter(Boolean));
