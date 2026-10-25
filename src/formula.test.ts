import { describe, expect, test } from "bun:test";
import { compareFx, compileFx, digitsOf, FX_EXAMPLES, FX_PRESETS, FxError, fxVars, type FxRow, type FxVars } from "./formula";

// Una serie con voto MAL mancante, per vedere come si propaga il dato che manca.
const x: FxVars = { v: 4, v_al: 3.5, v_mal: NaN, n: 100, s1: 10, s5: 50, my: NaN };

function run(src: string, vars = x) {
  const f = compileFx(src);
  if (f instanceof FxError) throw new Error(`«${src}» non compila: ${f.message}`);
  return f(vars);
}
function error(src: string) {
  const f = compileFx(src);
  if (!(f instanceof FxError)) throw new Error(`«${src}» doveva essere un errore`);
  return f;
}

describe("conti e precedenze come in JS", () => {
  test.each([
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["10 - 4 - 3", 3],
    ["7 % 4 * 2", 6],
    ["2 ** 3 ** 2", 512],
    ["1 < 2 && 3 > 4 || 5 >= 5", 1],
    ["!0 + 1", 2],
    ["1 ? 2 : 3", 2],
    ["0 ? 2 : 1 ? 4 : 5", 4],
    ["v * 2 - n / 50", 6],
    [".5 + 1.25", 1.75],
  ])("%s = %p", (src, want) => expect(run(src)).toBe(want));

  test("il meno davanti a una potenza vale per il risultato, come in matematica", () => expect(run("-2 ** 2 + 1")).toBe(-3));
  test("vero e falso sono 1 e 0", () => {
    expect(run("v > 3")).toBe(1);
    expect(run("v > 5")).toBe(0);
  });
});

describe("scrittura comoda sul telefono", () => {
  test("and, or, not al posto di &&, ||, !", () => {
    expect(run("v > 3 and v_al > 3")).toBe(1);
    expect(run("v > 5 or v_al > 3")).toBe(1);
    expect(run("not v > 5")).toBe(1);
  });
  test("not vale per tutto il confronto, come in SQL; ! resta quello di JS", () => {
    expect(run("not v > 5")).toBe(1);
    expect(run("not v > 3 and v_al > 3")).toBe(0);
    expect(run("v > 3 and not v_al > 5")).toBe(1);
    expect(run("not not v > 3")).toBe(1);
    expect(run("!v > 5")).toBe(0); // (!v) > 5
    expect(error("1 + not 0").message).toBe("«not» non va qui");
  });
  test("= da solo è un confronto", () => expect(run("v = 4")).toBe(1));
  test("i nomi non badano alle maiuscole", () => expect(run("V_AL + AVG(v, 1)")).toBe(6));
  test("gli spazi non contano", () => expect(run("  avg( v ,v_al )  ")).toBe(3.75));
});

describe("un dato che manca si propaga come NULL in SQL", () => {
  test.each([
    "v_mal + 1",
    "v_mal * 0",
    "v_mal >= 4",
    "v_mal == v_mal",
    "v_mal >= 4 or v >= 4",
    "v >= 4 or v_mal >= 4",
    "v_mal >= 4 and v < 0",
    "not v_mal",
    "-v_mal",
    "v_mal ? 1 : 2",
    "avg(v, v_al, v_mal)",
    "sum(v, v_mal)",
    "min(s1, v_mal)",
    "max(v_mal, 99)",
    "my >= 1",
  ])("%s è mancante", (src) => expect(run(src)).toBeNaN());

  test("ifnull dà il primo valore presente", () => {
    expect(run("ifnull(v_mal, v_al, 0)")).toBe(3.5);
    expect(run("ifnull(v_mal, 0)")).toBe(0);
    expect(run("ifnull(v, 0)")).toBe(4);
    expect(run("ifnull(v_mal, my)")).toBeNaN();
  });
  test("con ifnull un or riprende la serie senza voto MAL", () => expect(run("ifnull(v_mal, 0) >= 4 or v >= 4")).toBe(1));
  test("il ramo non scelto di un ?: non conta", () => expect(run("v > 3 ? v_al : v_mal")).toBe(3.5));
  test("una funzione senza argomenti non ha risultato", () => expect(run("avg()")).toBeNaN());
});

describe("errori", () => {
  test.each([
    ["foo(1)", "«foo» non è una variabile né una funzione"],
    ["avg", "avg vuole le parentesi: avg(…)"],
    ["v v_al", "«v_al» non va qui"],
    ["1)", "«)» non va qui"],
    ["*3", "«*» non va qui"],
    ["v(1)", "«(» non va qui"],
  ])("%s: %s", (src, msg) => {
    const e = error(src);
    expect(e.message).toBe(msg);
    expect(e.incomplete).toBe(false);
  });

  // Mentre si scrive una formula è quasi sempre incompleta: la pagina non lo segnala finché non la si usa.
  test.each(["", "   ", "avg(v,", "(v + 1", "v +", "1 ? 2", "not"])("«%s» è solo incompleta", (src) => expect(error(src).incomplete).toBe(true));
});

describe("una formula non può eseguire codice", () => {
  // Il testo può arrivare incollato da chissà dove: niente nomi fuori elenco, niente stringhe né accesso a proprietà.
  test.each(["alert(1)", "constructor", "__proto__", "toString(1)", "hasOwnProperty", "x.constructor", "v_al[0]", "'a'", '"a"', "`a`", "1 ; 2", "a => 1", "v = 1 ; fetch(1)"])(
    "%s non compila",
    (src) => expect(compileFx(src)).toBeInstanceOf(FxError),
  );
});

test("le formule pronte e gli esempi compilano", () => {
  for (const src of [...FX_PRESETS.map((p) => p.fx), ...FX_EXAMPLES]) expect(compileFx(src)).toBeFunction();
});

test("la stessa formula si compila una volta sola", () => expect(compileFx("v + 1")).toBe(compileFx("v + 1")));

describe("variabili di una riga", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  const row: FxRow = {
    votes: 1000, rating: 4.2, al: 4.1, mal: -1, al_votes: 300, mal_votes: 0,
    stars: [{ pct: 50 }, { pct: 0 }, { pct: 0 }, { pct: 0 }, { pct: 50 }],
    my_rating: 0, year: 2020, episodes: 24, seasons: 2, latest: "2026-10-20T12:00:00Z",
    in_watchlist: false, ep_done: 0, wl_rank: 0,
  };
  const vars = fxVars(row, now);

  test("voti e votanti", () => {
    expect(vars).toMatchObject({ v: 4.2, v_al: 4.1, n: 1000, n_al: 300, s1: 50, s5: 50, anno: 2020, ep: 24, stagioni: 2, wl: 0 });
  });
  test("senza abbinamento (-1) o senza voti esterni scaricati (-2) il voto e i votanti mancano", () => {
    expect(vars.v_mal).toBeNaN();
    expect(vars.n_mal).toBeNaN();
    expect(fxVars({ ...row, al: -2 }, now).v_al).toBeNaN();
  });
  test("sd: metà 1★ e metà 5★ è la dispersione massima, 2", () => expect(vars.sd).toBeCloseTo(2, 9));
  test("sd: tutte 5★ è zero", () => expect(fxVars({ ...row, stars: [0, 0, 0, 0, 100].map((pct) => ({ pct })) }, now).sd).toBe(0));
  test("il voto personale non dato manca, non è 0", () => expect(vars.my).toBeNaN());
  test("viste solo per le serie in watchlist", () => {
    expect(vars.viste).toBeNaN();
    expect(fxVars({ ...row, in_watchlist: true, ep_done: 7 }, now).viste).toBe(7);
  });
  test("giorni dall'ultima puntata, mancanti se non la si conosce", () => {
    expect(vars.giorni).toBe(5);
    expect(fxVars({ ...row, latest: "" }, now).giorni).toBeNaN();
  });
  test("una serie senza voti Crunchyroll non ha voto, stelle né sd", () => {
    const none = fxVars({ ...row, votes: 0 }, now);
    for (const k of ["v", "s1", "s5", "sd"]) expect(none[k]).toBeNaN();
    expect(none.n).toBe(0);
  });
  test("v_bayes lo mette la pagina, che lo ricalcola quando cambia m", () => expect(vars.v_bayes).toBeNaN());
  test("una formula legge le variabili della riga", () => expect(run("avg(v, v_al)", vars)).toBeCloseTo(4.15, 9));
});

describe("ordinamento", () => {
  const sort = (ys: number[], desc: boolean) => [...ys].sort((a, b) => compareFx(a, b, desc));
  test("il dato mancante va in fondo in entrambi i versi", () => {
    expect(sort([2, NaN, 3, 1], true)).toEqual([3, 2, 1, NaN]);
    expect(sort([2, NaN, 3, 1], false)).toEqual([1, 2, 3, NaN]);
  });
  test("due mancanti sono pari: decide il criterio dopo", () => expect(compareFx(NaN, NaN, true)).toBe(0));
});

describe("decimali della colonna ƒ", () => {
  test.each([
    [[1, 2, 300], 0],
    [[43.9, 43, 42.5], 1],
    [[4.667, 4.5], 3],
    [[1 / 3], 3],
    [[0.1 + 0.2], 1],
    [[NaN, 2.25, Infinity], 2],
    [[], 0],
  ])("%p → %i", (ys, want) => expect(digitsOf(ys)).toBe(want));
});

test("la pagina riceve il motore come globale Formula, impacchettato con le librerie", async () => {
  // Lo stesso impacchettamento di table.ts, eseguito in un contesto a parte come farebbe il browser.
  const bundle = await Bun.build({ entrypoints: [`${import.meta.dir}/page-vendor.ts`], format: "iife", target: "browser", minify: true });
  expect(bundle.success).toBe(true);
  const { runInNewContext } = await import("node:vm");
  const page: Record<string, any> = {};
  page.globalThis = page;
  runInNewContext(await bundle.outputs[0]!.text(), page);
  expect(page.Formula.compileFx("ifnull(v_mal, 0) + 1")({ v_mal: NaN })).toBe(1);
  expect(page.VirtualCore.Virtualizer).toBeFunction();
});
