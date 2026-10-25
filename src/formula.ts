/**
 * Le formule della scheda ƒ: un'espressione scritta nella pagina e calcolata per ogni serie, che ordina (un
 * criterio "f:<testo>" nella pila, come gli altri) o filtra (tiene le serie per cui è vera). Sta in un modulo a
 * sé, e non nello script della pagina, per poterla provare con `bun test`: page-vendor.ts la espone come
 * globale `Formula` e table.ts la impacchetta dentro index.html.
 *
 * Un dato che manca (nessun voto MAL, serie non votata) è NaN e si propaga come in SQL con NULL: in +, nei
 * confronti, in and/or e nelle funzioni, tranne ifnull che lo sostituisce. Senza risultato una serie non passa il
 * filtro e nell'ordinamento va in fondo in entrambi i versi. Scrivere ifnull dove serve è meglio che saltare di
 * nascosto il dato mancante: una media sul solo voto Crunchyroll, con trenta votanti, finirebbe in cima.
 */

export const FX_VARS: Record<string, string> = {
  v: "voto Crunchyroll, 1–5", v_bayes: "V Bayes, 1–5 (dipende da m nella scheda Voti)", v_al: "voto AniList, 1–5", v_mal: "voto MAL, 1–5",
  n: "votanti Crunchyroll", n_al: "votanti AniList", n_mal: "votanti MAL",
  ...Object.fromEntries([1, 2, 3, 4, 5].map((k) => [`s${k}`, `% di votanti Crunchyroll con ${k}★`])),
  sd: "deviazione standard delle stelle: alta se i voti sono sparsi o divisi fra 1★ e 5★ (0–2)",
  my: "il tuo voto, 1–5; manca se non l'hai votata", anno: "anno di uscita", ep: "puntate guardabili in Italia", stagioni: "stagioni guardabili in Italia",
  giorni: "giorni dall'ultima puntata", viste: "puntate viste, per le serie in watchlist", wl: "0 fuori watchlist, 1 dentro, 2 preferita",
};

type Fn = (...xs: number[]) => number;
// Un dato che manca rende mancante il risultato, come con +: anche in media, somma, minimo e massimo.
const strict = (fn: Fn): Fn => (...xs) => (!xs.length || xs.some(Number.isNaN) ? NaN : fn(...xs));
export const FX_FUNCS: Record<string, Fn> = {
  avg: strict((...xs) => xs.reduce((s, x) => s + x, 0) / xs.length),
  sum: strict((...xs) => xs.reduce((s, x) => s + x, 0)),
  min: strict(Math.min), max: strict(Math.max),
  ifnull: (...xs) => xs.find((x) => !Number.isNaN(x)) ?? NaN, // l'unica che passa sopra ai dati mancanti: dà il primo presente
  log10: Math.log10, log: Math.log, sqrt: Math.sqrt, abs: Math.abs, round: Math.round,
};
export const FX_HELP: Record<string, string> = {
  avg: "media", sum: "somma", min: "il minore", max: "il maggiore",
  ifnull: "ifnull(x, y, …): il primo valore presente, es. ifnull(v_mal, 0)", log10: "logaritmo in base 10, per i votanti",
  and: "tutte e due vere", or: "almeno una vera",
};
// Parole al posto di && e ||, che sulla tastiera del telefono sono due pagine più in là; "=" da solo è quasi sempre un confronto.
// not non è !: come in SQL e Python vale per tutto il confronto che segue, "not v > 4" è "not (v > 4)".
const FX_WORDS: Record<string, string> = { and: "&&", or: "||", not: "not" };
export const FX_PRESETS = [
  { label: "Media dei tre voti", fx: "avg(v, v_al, v_mal)" },
  { label: "Somma dei tre voti", fx: "v + v_al + v_mal" },
  { label: "Divisive: tanti 1★ e tanti 5★", fx: "min(s1, s5)" },
  { label: "Dispersione delle stelle", fx: "sd" },
  { label: "AniList più generoso di Crunchyroll", fx: "v_al - v" },
];
export const FX_EXAMPLES = [
  "avg(v, v_al, v_mal) >= 4.3 and n < 2000",
  "s1 >= 10 and s5 >= 50",
  "ifnull(my, 0) >= 1 and wl == 0",
  "giorni <= 14",
];

export type FxVars = Record<string, number>;
export type Formula = (x: FxVars) => number;
export class FxError extends Error {
  /** Il problema è solo che la formula non è finita: mentre la si scrive è normale, e la pagina non lo segnala. */
  incomplete = false;
}
const incomplete = (msg: string) => Object.assign(new FxError(msg), { incomplete: true });
// Vero e falso sono 1 e 0, e un confronto o un and con un dato mancante dà un dato mancante: tutto resta un numero.
const bool = (f: (a: number, b: number) => unknown) => (a: number, b: number) => (Number.isNaN(a) || Number.isNaN(b) ? NaN : +!!f(a, b));
const negate = (a: Formula): Formula => (x) => { const v = a(x); return Number.isNaN(v) ? NaN : +!v; };
const NOT_LEVEL = 2;
const BINARY: Record<string, (a: number, b: number) => number>[] = [
  { "||": bool((a, b) => a || b) },
  { "&&": bool((a, b) => a && b) },
  // qui sta anche not, prima del confronto (vedi binary)
  { "<": bool((a, b) => a < b), ">": bool((a, b) => a > b), "<=": bool((a, b) => a <= b), ">=": bool((a, b) => a >= b), "==": bool((a, b) => a === b), "!=": bool((a, b) => a !== b) },
  { "+": (a, b) => a + b, "-": (a, b) => a - b },
  { "*": (a, b) => a * b, "/": (a, b) => a / b, "%": (a, b) => a % b },
];
type Token = { num: number } | { op: string } | { name: string; raw: string };

const cache = new Map<string, Formula | FxError>();
/**
 * La formula diventa un albero di funzioni JS scritte qui, senza eval: il testo può nominare solo le variabili
 * della serie e le funzioni dell'elenco. Dà la funzione, o un FxError col motivo.
 */
export function compileFx(src: string): Formula | FxError {
  const hit = cache.get(src);
  if (hit) return hit;
  let out: Formula | FxError;
  try {
    out = parse(tokenize(src));
  } catch (e) {
    if (!(e instanceof FxError)) throw e;
    out = e;
  }
  cache.set(src, out);
  return out;
}

function tokenize(src: string): Token[] {
  const re = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([A-Za-z_]\w*)|(\*\*|<=|>=|==|!=|&&|\|\||[-+*\/%()<>,!?:=]))/y;
  const toks: Token[] = [];
  while (re.lastIndex < src.length) {
    const at = re.lastIndex, m = re.exec(src);
    if (!m) {
      const rest = src.slice(at).trim();
      if (!rest) break;
      throw new FxError(`«${rest[0]}» non si può usare`);
    }
    const w = m[2]?.toLowerCase();
    toks.push(m[1] ? { num: Number(m[1]) } : m[3] ? { op: m[3] === "=" ? "==" : m[3] } : Object.hasOwn(FX_WORDS, w!) ? { op: FX_WORDS[w!]! } : { name: w!, raw: m[2]! });
  }
  return toks;
}

function parse(toks: Token[]): Formula {
  let i = 0;
  const peek = () => { const t = toks[i]; return t && "op" in t ? t.op : undefined; };
  const expect = (op: string) => {
    if (i >= toks.length) throw incomplete(`manca «${op}»`);
    if (peek() !== op) throw new FxError(`qui ci vuole «${op}»`);
    i++;
  };
  const ternary = (): Formula => {
    const c = binary(0);
    if (peek() !== "?") return c;
    i++;
    const a = ternary();
    expect(":");
    const b = ternary();
    return (x) => { const k = c(x); return Number.isNaN(k) ? NaN : k ? a(x) : b(x); };
  };
  const binary = (level: number): Formula => {
    if (level === BINARY.length) return unary();
    if (level === NOT_LEVEL && peek() === "not") { i++; return negate(binary(level)); }
    let left = binary(level + 1);
    for (let op = peek(); op && Object.hasOwn(BINARY[level]!, op); op = peek()) {
      i++;
      const f = BINARY[level]![op]!, l = left, r = binary(level + 1);
      left = (x) => f(l(x), r(x));
    }
    return left;
  };
  const unary = (): Formula => {
    const op = peek();
    if (op === "-" || op === "+" || op === "!") {
      i++;
      const a = unary();
      return op === "-" ? (x) => -a(x) : op === "+" ? a : negate(a);
    }
    const base = primary();
    if (peek() !== "**") return base;
    i++;
    const e = unary(); // a destra, come in matematica: 2 ** 3 ** 2 = 2 ** 9, e -2 ** 2 = -4
    return (x) => base(x) ** e(x);
  };
  const primary = (): Formula => {
    const t = toks[i++];
    if (!t) throw incomplete("formula non finita");
    if ("num" in t) return () => t.num;
    if ("op" in t) {
      if (t.op !== "(") throw new FxError(`«${t.op}» non va qui`);
      const e = ternary();
      expect(")");
      return e;
    }
    const f = Object.hasOwn(FX_FUNCS, t.name) ? FX_FUNCS[t.name]! : undefined;
    if (f) {
      if (peek() !== "(") throw new FxError(`${t.name} vuole le parentesi: ${t.name}(…)`);
      i++;
      const args: Formula[] = [];
      if (peek() !== ")") {
        args.push(ternary());
        while (peek() === ",") { i++; args.push(ternary()); }
      }
      expect(")");
      return (x) => f(...args.map((a) => a(x)));
    }
    if (Object.hasOwn(FX_VARS, t.name)) return (x) => x[t.name] ?? NaN;
    throw new FxError(`«${t.raw}» non è una variabile né una funzione`);
  };
  if (!toks.length) throw incomplete("formula vuota");
  const out = ternary();
  const t = toks[i];
  if (t) throw new FxError(`«${"op" in t ? t.op : "raw" in t ? t.raw : t.num}» non va qui`);
  return out;
}

/** I campi di una riga della pagina (table.ts) da cui vengono le variabili. */
export type FxRow = {
  votes: number; rating: number; al: number; mal: number; al_votes: number; mal_votes: number;
  stars: { pct: number }[]; my_rating: number; year?: number | null; episodes: number; seasons: number;
  latest: string; in_watchlist: boolean; ep_done: number; wl_rank: number;
};
/** Le variabili di una serie; `v_bayes` resta NaN, la pagina lo aggiorna a ogni render perché segue m. */
export function fxVars(r: FxRow, now: number): FxVars {
  const p = r.stars.map((s) => s.pct / 100), mean = p.reduce((a, q, i) => a + q * (i + 1), 0);
  return {
    v: r.votes ? r.rating : NaN, v_bayes: NaN,
    // -1 e -2 nelle righe sono "nessun abbinamento" e "voti esterni non scaricati": qui entrambi un dato che manca
    v_al: r.al >= 0 ? r.al : NaN, v_mal: r.mal >= 0 ? r.mal : NaN,
    n: r.votes, n_al: r.al >= 0 ? r.al_votes : NaN, n_mal: r.mal >= 0 ? r.mal_votes : NaN,
    ...Object.fromEntries(r.stars.map((s, i) => [`s${i + 1}`, r.votes ? s.pct : NaN])),
    sd: r.votes ? Math.sqrt(p.reduce((a, q, i) => a + q * (i + 1 - mean) ** 2, 0)) : NaN,
    my: r.my_rating || NaN, anno: r.year ?? NaN, ep: r.episodes, stagioni: r.seasons,
    giorni: r.latest ? Math.floor((now - Date.parse(r.latest)) / 864e5) : NaN,
    viste: r.in_watchlist ? r.ep_done : NaN, wl: r.wl_rank,
  };
}

/** I decimali che servono, fino a 3: uguali per tutta la colonna ƒ, così i numeri si incolonnano, e nessuno per i conteggi. */
export const digitsOf = (ys: number[]) =>
  Math.max(0, ...ys.filter(Number.isFinite).map((y) => [0, 1, 2].find((d) => Math.abs(y * 10 ** d - Math.round(y * 10 ** d)) < 1e-6) ?? 3));

/**
 * Confronto di due valori di formula nel verso scelto, col dato mancante in fondo in entrambi i versi; 0 se
 * sono pari, o mancano tutti e due, e decide il criterio dopo.
 */
export function compareFx(x: number, y: number, desc: boolean): number {
  const nx = Number.isNaN(x), ny = Number.isNaN(y);
  if (nx || ny) return nx === ny ? 0 : nx ? 1 : -1;
  return desc ? y - x : x - y;
}
