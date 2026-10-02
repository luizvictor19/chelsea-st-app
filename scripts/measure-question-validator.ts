/**
 * Counts what the question validator marks on real sentences, rule by rule.
 *
 * The validator warns when a question uses a word its point has not
 * presented. Its known problem is noise: a capital, a full stop, an
 * apostrophe, a term of several words. Each normalisation that removes noise
 * can also remove a true mark, so none goes in from memory: this prints, for
 * each rule, how many marks it takes away, and lists the marks that are left
 * so each can be read and called true or noise by eye.
 *
 * Three files, none of them in the repository (fixtures/ is ignored whole,
 * and two of them are the book's own sentences):
 *
 *   vocabulary.tsv   point, term, contrast set: vocabulary_items as read
 *                    from the project on the day written in its header
 *   lesson1.tsv      point, question, answer: lesson 1 of book 1 as printed
 *   dictation1.tsv   point, sentence: Dictation 1 as stored in blocks
 *
 * The printed questions and answers are not in the database: the extractor
 * files no question and answer line as a block (criterion 7 of
 * docs/spec-ingestao.md), so lesson 1 was read off the page images.
 *
 *   node scripts/measure-question-validator.ts
 *   node scripts/measure-question-validator.ts --fixtures fixtures/questions
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  RULES,
  comparePlaces,
  createChecker,
  presentationPlaces,
  type Mark,
  type Place,
  type Rule,
  type VocabularyWord,
} from "../src/lib/questions/presented.ts";

const ROOT = join(import.meta.dirname, "..");

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
}

const FIXTURES = option("fixtures", join(ROOT, "fixtures", "questions"));

/** Both corpora are book 1. */
const BOOK = 1;

function rows(file: string): readonly string[][] {
  const path = join(FIXTURES, file);
  if (!existsSync(path)) {
    console.error(
      `${path}: ausente. Este script mede contra arquivos que ficam fora do repositório.`,
    );
    process.exit(1);
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("#"))
    .map((line) => line.split("\t"));
}

const vocabulary: readonly VocabularyWord[] = rows("vocabulary.tsv").map(
  ([point, term, set]) => ({
    term,
    place: { book: BOOK, point: Number(point) },
    setId: set === "-" ? null : set,
  }),
);

type Sentence = { readonly text: string; readonly at: Place };

const lesson1: readonly Sentence[] = rows("lesson1.tsv").flatMap(
  ([point, question, answer]) => {
    const at = { book: BOOK, point: Number(point) };
    return [
      { text: question, at },
      { text: answer, at },
    ];
  },
);

const dictation1: readonly Sentence[] = rows("dictation1.tsv").map(
  ([point, text]) => ({ text, at: { book: BOOK, point: Number(point) } }),
);

type Found = Mark & { readonly at: Place };

function marks(
  sentences: readonly Sentence[],
  rules: readonly Rule[],
): readonly Found[] {
  const checker = createChecker(vocabulary, rules);
  return sentences.flatMap(({ text, at }) =>
    checker.check(text, at).map((mark) => ({ ...mark, at })),
  );
}

/** "London x6 (ponto 4, apresentada no 26)", most frequent first. */
function listed(found: readonly Found[]): string {
  const counts = new Map<string, { n: number; first: Found }>();
  for (const mark of found) {
    const key = mark.word;
    const entry = counts.get(key);
    if (entry === undefined) counts.set(key, { n: 1, first: mark });
    else entry.n += 1;
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0], "en"))
    .map(([word, { n, first }]) => {
      const where =
        first.presentedAt === null
          ? "fora do vocabulário"
          : `apresentada no ponto ${first.presentedAt.point}`;
      return `    ${word} x${n} (usada no ponto ${first.at.point}, ${where})`;
    })
    .join("\n");
}

function wordCount(sentences: readonly Sentence[]): number {
  return sentences.reduce(
    (total, { text }) => total + (text.match(/\S+/gu)?.length ?? 0),
    0,
  );
}

function report(name: string, sentences: readonly Sentence[]) {
  console.log(`\n${name}`);
  console.log(
    `  ${sentences.length} frases, ${wordCount(sentences)} palavras (trechos entre espaços)`,
  );

  console.log("\n  Regras somadas uma a uma, na ordem de RULES:");
  console.log(`    ${"nenhuma".padEnd(14)} ${marks(sentences, []).length}`);
  RULES.forEach((rule, index) => {
    const upTo = RULES.slice(0, index + 1);
    console.log(`    + ${rule.padEnd(12)} ${marks(sentences, upTo).length}`);
  });

  const all = marks(sentences, RULES);
  console.log("\n  Cada regra tirada sozinha das cinco:");
  for (const rule of RULES) {
    const without = marks(
      sentences,
      RULES.filter((other) => other !== rule),
    );
    console.log(
      `    sem ${rule.padEnd(12)} ${without.length}  (ela responde por ${without.length - all.length})`,
    );
  }

  console.log(`\n  Marcas que sobram com as cinco regras: ${all.length}`);
  console.log(listed(all) || "    nenhuma");

  /*
   * The rules that were considered and are not in the validator, counted
   * over what is left: how many of the remaining marks each would remove.
   */
  const checker = createChecker(vocabulary, RULES);
  const pluralS = all.filter((mark) => {
    const stem = /^(.+?)(?:es|s)$/u.exec(mark.word)?.[1];
    return stem !== undefined && checker.check(stem, mark.at).length === 0;
  });
  const capital = all.filter((mark) => /^\p{Lu}/u.test(mark.word));
  console.log("\n  Regras que não entraram, contadas sobre o que sobra:");
  console.log(`    plural ou terceira pessoa (s final): ${pluralS.length}`);
  console.log(`    começa com maiúscula (nome próprio): ${capital.length}`);

  // What case folding lets through by coincidence: the surname and the colour.
  const brown = sentences.reduce(
    (total, { text }) => total + (text.match(/\bBrown\b/gu)?.length ?? 0),
    0,
  );
  console.log(`\n  "Brown" (sobrenome) nas frases: ${brown}`);
}

console.log(`Vocabulário: ${vocabulary.length} itens`);

const places = presentationPlaces(vocabulary);
const moved = vocabulary.filter(
  (item, index) => comparePlaces(item.place, places[index]) !== 0,
);
const sets = new Set(vocabulary.flatMap((item) => item.setId ?? []));
console.log(
  `Conjuntos de contraste: ${sets.size}. Palavras que o conjunto empurra para um ponto mais tarde: ${moved.length}`,
);

report("Lição 1 do livro 1, perguntas e respostas impressas", lesson1);
report("Dictation 1, bloco do ponto 47", dictation1);
