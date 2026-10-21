import { $ } from "bun";

/**
 * Storico: copia i file di dati dati come argomenti (es. data/catalog-IT.ndjson) nel ramo `history` e ne fa
 * un commit. Il ramo non ha niente in comune con main e non scade come gli artifact; git salva solo cosa
 * cambia fra una settimana e l'altra, e qualsiasi dato a qualsiasi data si rilegge con
 * `git show history@{…}:catalog-IT.ndjson` o percorrendo i commit.
 *
 * Le righe si scrivono ordinate per id: l'ordine del catalogo (per popolarità) cambia ogni settimana, e
 * righe spostate peserebbero come righe cambiate. Si lancia dal workflow, con permessi `contents: write`.
 */
const files = Bun.argv.slice(2);
if (!files.length) throw new Error("uso: bun run src/history.ts <file>...");
const dir = `${import.meta.dir}/../../history`;

if ((await $`git ls-remote --exit-code --heads origin history`.nothrow().quiet()).exitCode === 0) {
  await $`git fetch --depth=1 origin history`.quiet();
  await $`git worktree add -B history ${dir} FETCH_HEAD`.quiet();
} else {
  await $`git worktree add --orphan -b history ${dir}`.quiet(); // la prima volta
}

// Quando arriva il catalogo, i suoi file non passati sono di paesi tolti da COUNTRIES (il Giappone, il 20 ottobre
// 2026): senza toglierli resterebbero nell'ultimo commit come se fossero aggiornati. Il run dei voti non li tocca.
const names = new Set(files.map((f) => f.split("/").at(-1)!));
if ([...names].some((n) => n.startsWith("catalog-")))
  for (const name of await Array.fromAsync(new Bun.Glob("catalog-*.ndjson").scan(dir)))
    if (!names.has(name)) await Bun.file(`${dir}/${name}`).delete();

const idOf = (line: string) => (JSON.parse(line) as { id?: string }).id ?? "";
for (const file of files) {
  const name = file.split("/").at(-1)!;
  const text = await Bun.file(file).text();
  const sorted = name.endsWith(".ndjson")
    ? text.trim().split("\n").filter(Boolean).sort((a, b) => idOf(a).localeCompare(idOf(b))).join("\n") + "\n"
    : text;
  await Bun.write(`${dir}/${name}`, sorted);
}

await $`git -C ${dir} add -A`;
const changed = (await $`git -C ${dir} diff --cached --quiet`.nothrow().quiet()).exitCode !== 0;
if (!changed) {
  console.log("storico: niente di cambiato");
} else {
  const date = new Date().toISOString().slice(0, 10);
  await $`git -C ${dir} -c user.name=github-actions[bot] -c user.email=41898282+github-actions[bot]@users.noreply.github.com commit -qm ${`dati del ${date}: ${files.map((f) => f.split("/").at(-1)).join(", ")}`}`;
  await $`git -C ${dir} push -q origin history`;
  // Quanto pesa davvero il commit: il pacchetto sottile rispetto al precedente, coi delta, come lo manda il push.
  // count-objects non serve: il fetch di pochi oggetti li scompatta, e contava tutto l'albero (22 MiB il 20 ottobre).
  const pack = await $`git -C ${dir} pack-objects --revs --thin --stdout -q < ${new Response("HEAD\n^HEAD~1\n")}`.nothrow().quiet();
  const size = pack.exitCode === 0 ? `${(pack.stdout.length / 1e3).toFixed(0)} kB` : "primo commit";
  console.log(`storico: commit sul ramo history con ${files.length} file (${size} coi delta)`);
}
