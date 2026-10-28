# Piano: la pagina in Solid, con init/dispose e aggiornamento dei client aperti

File di lavoro del ramo `claude/solid-refactor`. **L'ultimo commit del ramo lo cancella**, insieme
all'aggiornamento finale del `CLAUDE.md`: a lavoro finito le regole stanno lì, non qui.

## Obiettivo

Lo script inline di `src/table.html` (≈ 800 righe, stringhe HTML, `render()` chiamato a mano) diventa:

- **funzioni pure** in `src/page/`, provate con `bun test`;
- **componenti Solid** compilati da `table.ts` con `Bun.build` e il preset Babel di Solid: JSX al posto delle
  stringhe (niente più `esc()`), reattività con signals e store, ogni effetto con il suo `onCleanup`;
- **un'app con `init(root, state, data) → dispose`** dentro `createRoot`, così si può smontare e rimontare
  con lo stesso stato;
- **un loader** che al ritorno in primo piano controlla l'`ETag` della pagina: se cambiano solo i dati li
  sostituisce al volo (`setData`), se cambia il codice smonta l'app, carica il bundle nuovo e la rimonta con
  lo stesso stato.

La pagina resta un file unico, senza CDN; il mobile resta il caso principale.

## Regole di lavoro

- Un passo = uno o più commit sul ramo, ognuno con la pagina funzionante. Si sostituisce un pezzo alla volta:
  per qualche passo vecchio script e componenti Solid convivono, e ogni componente nuovo toglie il codice
  vecchio corrispondente.
- Ogni passo si chiude in uno di due modi:
  - **test**: un test (unitario o e2e) scritto nel passo lo dimostra, e basta quello;
  - **deploy**: il ramo entra in `main` con un merge `--no-ff` e la verifica si fa sulla pagina pubblicata,
    sul telefono. Il ramo poi continua. Prima di ogni merge: `bun test`, typecheck ed e2e verdi.
- Il `CLAUDE.md` si aggiorna nel passo che cambia la cosa descritta, non tutto alla fine.
- Screenshot di verifica solo in viewport mobile, con dati sintetici dichiarati come tali.

## Passi

### 0. Rete di sicurezza: test e2e sui dati di prova — verifica: test

- I dati sintetici usati finora diventano `src/fixtures.ts`: genera `catalog.ndjson`, `ratings-external.json`,
  `watchlist-progress.json`, `watchlist-extra.json` della stessa forma degli artifact, con un seme fisso.
- `src/page.e2e.test.ts` (Playwright, `playwright-core`) genera la pagina dai dati di prova e prova:
  filtri (testo, paese ±, genere ±, watchlist), ordinamento da intestazione e dal pannello, formula che ordina
  e che filtra, link del titolo, apertura del dettaglio, swipe di lato, frecce, trascinamento in giù,
  chiusura con la ✕ e animazione, pagina sotto ferma a pannello aperto.
- Browser: in locale il Chromium di Playwright; in CI il Google Chrome già installato sui runner
  (`channel: "chrome"`, scelto da `E2E_CHANNEL`), quindi niente download e niente cache.
- `test.yml` lo fa girare dopo i test unitari. Deve passare sulla pagina di oggi, senza cambiarla.

### 1. Strumenti: Solid compilato da Bun — verifica: test

- Dipendenze fissate: `solid-js`, `babel-preset-solid`, `@babel/core`, `happy-dom` (DOM nei test).
- Un plugin Bun (poche righe) che passa i `.tsx` a Babel con il preset di Solid: usato da `Bun.build` in
  `table.ts` e, via `preload` in `bunfig.toml`, da `bun test`. `tsconfig`: `jsx: "preserve"`,
  `jsxImportSource: "solid-js"`.
- Test: un componente minimo; cambiare un signal aggiorna il DOM, `dispose` toglie nodi e listener
  (`onCleanup` chiamato).
- **Passo che decide**: se il plugin non regge con `Bun.build` o `bun test`, si ripiega su `solid-js/h`
  (JSX a runtime, espressioni reattive avvolte a mano) e il resto del piano non cambia.

### 2. Funzioni pure estratte — verifica: test, poi deploy

In `src/page/`, ciascuna coi suoi test:

- formattazione: percentuali a due cifre significative, date dell'ultima puntata, numeri;
- media bayesiana; filtro di una riga (`passa(riga, stato)`); confronto per l'ordinamento; giro dei clic
  sulle intestazioni (`(pila, clic, ora) → pila`);
- distribuzioni di una serie; geometria del grafico (posizioni delle colonne → percorsi SVG);
- testo di ogni cella, usato dalla cella e dalla riga metro (oggi ricavato togliendo i tag dall'HTML);
- riconoscimento dei gesti del dettaglio (`(dx, dy, in cima, bordo) → modo`).

Il vecchio script le usa dal bundle, come oggi fa con `Formula`. Pagina identica: merge e deploy.

### 3. Dati in JSON e hash del codice — verifica: test, poi deploy

- `table.ts` mette nel JSON di `<script id="data">` anche media del catalogo, paesi, `m` e la versione dei
  dati, invece di sostituirli nel testo dello script (`__C__`, `__COUNTRIES__`, `__M__`).
- Nella pagina, l'hash del solo codice (template, CSS, bundle) in un `<meta>`.
- Test: dalla generazione sui dati di prova, JSON completo; cambiando solo i dati l'hash del codice non cambia.

### 4. Stato in uno store — verifica: test, poi deploy

- `createStore` con tutto lo stato della vista: testo cercato, paesi e generi con segno, watchlist, pila di
  ordinamento, formula che filtra, `m`, scheda attiva, serie aperta (id), riga in cima (id).
- Il vecchio `render()` diventa un effetto sullo store. Lo stato si salva in `sessionStorage` e si ripristina
  all'avvio.
- Test: salvataggio e ripristino. Deploy: ricaricando la pagina filtri e ordinamento restano.

### 5. Primo componente: il dettaglio — verifica: e2e, poi deploy

- Componente con `Portal` per pannello e sfondo; si apre impostando la serie aperta nello store.
- Gesti (swipe di lato, trascinamento in giù), animazioni, blocco della pagina sotto (`sheet-open`), listener
  globali (Esc, frecce, resize) in `onCleanup`. Grafico disegnato da un effetto che misura le colonne.
- Il vecchio codice del pannello sparisce. Deploy: prova sul telefono.

### 6. Le schede dell'intestazione — verifica: e2e, poi deploy (tre volte)

- 6a: schede, Voti, ƒ (campo, chip, suggerimenti, formule recenti in `localStorage`).
- 6b: Filtri; Tom Select dentro un componente, `destroy()` in `onCleanup`, chip a tre stati.
- 6c: Ordinamento; Sortable allo stesso modo.

### 7. La tabella — verifica: e2e, poi deploy

- `@tanstack/solid-virtual` al posto del virtualizzatore fatto a mano; celle come componenti; riga metro dalle
  funzioni del passo 2; titolo = link, resto della riga = dettaglio; colonna ƒ e colonne dei paesi.
- Il passo più grosso. Deploy: prova sul telefono (scorrimento veloce su iOS, colonne ferme, barre, bandiere,
  striscia del titolo a tabella scorsa).

### 8. La radice dell'app — verifica: test, poi deploy

- `init(root, state, data)` in `createRoot`, restituisce `dispose`. Il vecchio script sparisce del tutto: il
  template resta scheletro, CSS, dati e bundle.
- Test (happy-dom): monta, smonta, non resta niente (nodi, listener, classi su `<html>`); rimonta con lo
  stesso stato e il DOM è lo stesso.

### 9. Aggiornamento dei soli dati — verifica: test, poi deploy

- `setData(json)`: righe nuove senza smontare; restano filtri e scroll (agganciato all'id della riga in cima);
  la serie aperta si ritrova per id, o il pannello si chiude se non c'è più.
- Test: dati nuovi con una serie in più e una in meno, stato invariato, pannello sulla stessa serie.

### 10. Il loader — verifica: test, poi deploy

- Piccolo e permanente, fuori dall'app: a `visibilitychange` (ritorno in primo piano) una `HEAD` della pagina
  con `cache: "no-store"` e un parametro che cambia, confronto dell'`ETag`.
- `ETag` cambiato: scarica la pagina, la legge con `DOMParser`. Stesso hash del codice → `setData`. Hash
  diverso → `dispose`, sostituisce il CSS, carica il bundle nuovo da un blob URL, `init` con lo stesso stato.
- Test: `fetch` simulato per i tre casi (niente di nuovo, solo dati, codice). Deploy: pagina aperta sul
  telefono, push di prova, tornando sulla scheda è aggiornata senza aver perso lo stato.

### 11. Chiusura

- `CLAUDE.md` rivisto per intero (struttura di `src/page/`, Solid, loader, test e2e), questo file cancellato,
  merge `--no-ff` in `main`.
