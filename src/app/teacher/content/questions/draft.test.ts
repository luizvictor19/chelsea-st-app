import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CHANGED_ELSEWHERE,
  EMPTY,
  SESSION_ENDED,
  CONTENT_WRITERS_ONLY,
  cleaned,
  closed,
  deleteError,
  failureMessage,
  isAnswerLanguage,
  isDirty,
  opened,
  parseFields,
  publishRefusal,
  questionError,
  questionRow,
  refusal,
  stillLoaded,
  type PictureOf,
  type QuestionFields,
  parseSuggestion,
  suggestionColumns,
} from "./draft.ts";
import { approvedPicture } from "../../../../lib/questions/shown-word.ts";

const SAVED: QuestionFields = {
  prompt: "Is this a lamp?",
  expectedAnswer: "Yes, it's a lamp.",
  answerLanguage: "en",
  isPublished: false,
  image: { kind: "none" },
};

const LAMP = "0b5c1f7e-3c0a-4a51-9d0e-6a4f2f1f0a11";
const SHELF = "7d2e9a44-1b6f-4c3d-8e2a-5f9b0c1d2e33";
const BOX = "5a1d3c9e-2b4f-4e6a-8c0d-1e2f3a4b5c66";
const PEN = "9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a";

describe("a question draft", () => {
  test("starts in English, unpublished and with no image decided", () => {
    assert.deepEqual(EMPTY, {
      prompt: "",
      expectedAnswer: "",
      answerLanguage: "en",
      isPublished: false,
      image: { kind: "none" },
    });
  });

  test("is refused without a question, then without an answer", () => {
    assert.equal(refusal(EMPTY), "Escreva a pergunta");
    assert.equal(refusal({ ...EMPTY, prompt: "   " }), "Escreva a pergunta");
    assert.equal(
      refusal({ ...EMPTY, prompt: "Is this a lamp?", expectedAnswer: " " }),
      "Escreva a resposta esperada",
    );
    assert.equal(refusal(SAVED), null);
  });

  test("is refused with Palavra or Cena chosen and no item picked", () => {
    assert.equal(
      refusal({ ...SAVED, image: { kind: "word", id: null } }),
      "Escolha a palavra mostrada",
    );
    assert.equal(
      refusal({ ...SAVED, image: { kind: "scene", id: null } }),
      "Escolha a cena",
    );
    assert.equal(
      refusal({ ...SAVED, image: { kind: "scene", id: BOX } }),
      null,
    );
    assert.equal(refusal({ ...SAVED, image: { kind: "acted" } }), null);
  });

  test("is stored without the space around either sentence", () => {
    assert.deepEqual(
      cleaned({
        ...SAVED,
        prompt: "  Is this a lamp? ",
        expectedAnswer: "Yes \n",
      }),
      { ...SAVED, prompt: "Is this a lamp?", expectedAnswer: "Yes" },
    );
  });

  test("is dirty when the word it shows is chosen, changed or taken off", () => {
    const shown: QuestionFields = {
      ...SAVED,
      image: { kind: "word", id: LAMP },
    };
    assert.equal(isDirty(shown, SAVED), true);
    assert.equal(
      isDirty({ ...shown, image: { kind: "word", id: SHELF } }, shown),
      true,
    );
    assert.equal(isDirty(SAVED, shown), true);
    assert.equal(isDirty(shown, { ...shown }), false);
  });

  test("is dirty when only the kind of image changes", () => {
    const scene: QuestionFields = {
      ...SAVED,
      image: { kind: "scene", id: BOX },
    };
    assert.equal(isDirty({ ...SAVED, image: { kind: "acted" } }, SAVED), true);
    assert.equal(isDirty(SAVED, { ...SAVED, image: { kind: "acted" } }), true);
    assert.equal(
      isDirty({ ...scene, image: { kind: "word", id: null } }, scene),
      true,
    );
  });

  test("is dirty when only the scene changes", () => {
    const scene: QuestionFields = {
      ...SAVED,
      image: { kind: "scene", id: BOX },
    };
    assert.equal(
      isDirty({ ...scene, image: { kind: "scene", id: PEN } }, scene),
      true,
    );
    assert.equal(
      isDirty({ ...scene, image: { kind: "scene", id: BOX } }, scene),
      false,
    );
  });

  test("is dirty when any of the other four fields differs", () => {
    assert.equal(isDirty(SAVED, SAVED), false);
    assert.equal(
      isDirty({ ...SAVED, prompt: "Is this a shelf?" }, SAVED),
      true,
    );
    assert.equal(isDirty({ ...SAVED, expectedAnswer: "No." }, SAVED), true);
    assert.equal(isDirty({ ...SAVED, answerLanguage: "pt" }, SAVED), true);
    assert.equal(isDirty({ ...SAVED, isPublished: true }, SAVED), true);
  });

  test("is not dirty for a space a save would drop", () => {
    assert.equal(
      isDirty({ ...SAVED, prompt: "Is this a lamp? " }, SAVED),
      false,
    );
  });
});

describe("parseFields", () => {
  test("accepts the fields and nothing less", () => {
    assert.deepEqual(parseFields(SAVED), SAVED);
    assert.equal(parseFields(null), null);
    assert.equal(parseFields("Is this a lamp?"), null);
    assert.equal(parseFields({ ...SAVED, prompt: 3 }), null);
    assert.equal(parseFields({ ...SAVED, expectedAnswer: undefined }), null);
    assert.equal(parseFields({ ...SAVED, isPublished: "true" }), null);
  });

  test("takes each of the four kinds of image", () => {
    for (const image of [
      { kind: "none" },
      { kind: "word", id: LAMP },
      { kind: "scene", id: BOX },
      { kind: "acted" },
      // Chosen and not picked yet: refusal says so in words.
      { kind: "word", id: null },
      { kind: "scene", id: null },
    ] as const) {
      const fields = { ...SAVED, image };
      assert.deepEqual(parseFields(fields), fields, image.kind);
    }
  });

  test("refuses an unknown kind and an id that is not a uuid", () => {
    assert.equal(parseFields({ ...SAVED, image: { kind: "photo" } }), null);
    assert.equal(parseFields({ ...SAVED, image: "none" }), null);
    assert.equal(parseFields({ ...SAVED, image: null }), null);
    for (const id of ["lamp", "", 7, undefined]) {
      assert.equal(
        parseFields({ ...SAVED, image: { kind: "word", id } }),
        null,
        String(id),
      );
      assert.equal(
        parseFields({ ...SAVED, image: { kind: "scene", id } }),
        null,
        String(id),
      );
    }
  });

  test("refuses the image left out", () => {
    // Left out is not "keep what the row had": a write built from it would
    // leave the old columns in place, in silence.
    const without: Record<string, unknown> = { ...SAVED };
    delete without.image;
    assert.equal(parseFields(without), null);
  });

  test("does not take the old field in place of the image", () => {
    const old: Record<string, unknown> = { ...SAVED, shownWordId: LAMP };
    delete old.image;
    assert.equal(parseFields(old), null);
  });

  test("keeps only the kind and the item of the image", () => {
    assert.deepEqual(
      parseFields({ ...SAVED, image: { kind: "acted", id: LAMP } }),
      { ...SAVED, image: { kind: "acted" } },
    );
  });

  test("refuses a language the database does not list", () => {
    assert.equal(parseFields({ ...SAVED, answerLanguage: "fr" }), null);
    assert.equal(isAnswerLanguage("pt"), true);
    assert.equal(isAnswerLanguage("PT"), false);
  });

  test("drops anything else it is handed", () => {
    assert.deepEqual(parseFields({ ...SAVED, position: 9 }), SAVED);
  });
});

describe("questionError", () => {
  test("a stale order and a taken position are the same news", () => {
    assert.equal(questionError("anything", "QS001"), CHANGED_ELSEWHERE);
    assert.equal(questionError("duplicate key", "23505"), CHANGED_ELSEWHERE);
  });

  test("a question a student holds says how to retire it, on a delete", () => {
    assert.match(
      deleteError("violates foreign key constraint", "23503"),
      /desmarque Publicada/,
    );
  });

  test("a foreign key refusal anywhere else is not about deleting", () => {
    // Adding to a point removed in another tab is 23503 as well.
    assert.equal(
      questionError("violates foreign key constraint", "23503"),
      "violates foreign key constraint",
    );
  });

  test("a delete still hears the refusals every write shares", () => {
    assert.equal(deleteError("anything", "QS001"), CHANGED_ELSEWHERE);
    assert.match(
      deleteError("question 1ce2 not found", "P0001"),
      /não existe mais/,
    );
  });

  test("a scene excluded meanwhile says so", () => {
    const refused =
      "scene 5a1d3c9e is archived and cannot be shown by a question";
    assert.match(
      questionError(refused, "23514"),
      /cena escolhida foi excluída/,
    );
  });

  test("a scene that is gone says so", () => {
    const refused =
      'insert or update on table "questions" violates foreign key constraint "questions_scene_id_fkey"';
    assert.match(questionError(refused, "23503"), /cena escolhida não existe/);
  });

  test("two images at once is said in words", () => {
    const refused =
      'new row for relation "questions" violates check constraint "questions_one_image"';
    assert.match(questionError(refused, "23514"), /uma imagem/);
  });

  test("a word that is gone says which field", () => {
    const refused =
      'insert or update on table "questions" violates foreign key constraint "questions_shown_vocabulary_item_id_fkey"';
    assert.match(questionError(refused, "23503"), /palavra escolhida/);
  });

  test("a question that is gone says to reload", () => {
    assert.match(
      questionError("question 1ce280b7 not found", "P0001"),
      /não existe mais/,
    );
  });

  test("an unknown refusal is passed through as it came", () => {
    assert.equal(
      questionError("permission denied", "42501"),
      "permission denied",
    );
  });
});

describe("a save writes and checks every column", () => {
  const IMAGE_COLUMNS = [
    "is_acted_out",
    "scene_id",
    "shown_vocabulary_item_id",
  ];

  test("the row always carries the three image columns", () => {
    for (const image of [
      { kind: "none" },
      { kind: "word", id: LAMP },
      { kind: "scene", id: BOX },
      { kind: "acted" },
    ] as const) {
      const row = questionRow({ ...SAVED, image });
      assert.ok(row !== null, image.kind);
      for (const column of IMAGE_COLUMNS) {
        assert.ok(column in row, `${image.kind}: ${column}`);
      }
    }
  });

  test("a scene chosen with no item is no row", () => {
    assert.equal(
      questionRow({ ...SAVED, image: { kind: "scene", id: null } }),
      null,
    );
    assert.equal(
      stillLoaded({ ...SAVED, image: { kind: "word", id: null } }),
      null,
    );
  });

  test("the check names every column the write sets", () => {
    for (const image of [
      { kind: "none" },
      { kind: "word", id: LAMP },
      { kind: "scene", id: BOX },
      { kind: "acted" },
    ] as const) {
      const fields = { ...SAVED, image };
      const row = questionRow(fields);
      const matches = stillLoaded(fields);
      assert.ok(row !== null && matches !== null);
      assert.deepEqual(
        matches.map((match) => match.column).sort(),
        Object.keys(row).sort(),
        image.kind,
      );
    }
  });

  test("the check holds the image as the form opened on it", () => {
    // Opened on a word: an edit in another tab that set a scene, or acted
    // out, leaves a row these three no longer match, and the save writes
    // nothing.
    const matches = stillLoaded({
      ...SAVED,
      image: { kind: "word", id: LAMP },
    });
    assert.ok(matches !== null);
    const image = matches.filter((match) =>
      IMAGE_COLUMNS.includes(match.column),
    );
    assert.deepEqual(
      image.sort((a, b) => a.column.localeCompare(b.column)),
      [
        { column: "is_acted_out", op: "eq", value: false },
        { column: "scene_id", op: "is", value: null },
        { column: "shown_vocabulary_item_id", op: "eq", value: LAMP },
      ],
    );
  });

  test("a scene and acted out are checked too, null by is", () => {
    const scene = stillLoaded({ ...SAVED, image: { kind: "scene", id: BOX } });
    assert.ok(scene !== null);
    assert.deepEqual(
      scene
        .filter((match) => IMAGE_COLUMNS.includes(match.column))
        .sort((a, b) => a.column.localeCompare(b.column)),
      [
        { column: "is_acted_out", op: "eq", value: false },
        { column: "scene_id", op: "eq", value: BOX },
        { column: "shown_vocabulary_item_id", op: "is", value: null },
      ],
    );
    const acted = stillLoaded({ ...SAVED, image: { kind: "acted" } });
    assert.ok(acted !== null);
    assert.deepEqual(
      acted
        .filter((match) => IMAGE_COLUMNS.includes(match.column))
        .sort((a, b) => a.column.localeCompare(b.column)),
      [
        { column: "is_acted_out", op: "eq", value: true },
        { column: "scene_id", op: "is", value: null },
        { column: "shown_vocabulary_item_id", op: "is", value: null },
      ],
    );
  });

  test("the check never compares a null with eq", () => {
    const matches = stillLoaded(SAVED);
    assert.ok(matches !== null);
    for (const match of matches) {
      if (match.value === null) assert.equal(match.op, "is", match.column);
    }
  });
});

/** Only LAMP and BOX have an approved picture. */
const pictureOf: PictureOf = (kind, id) =>
  (kind === "word" && id === LAMP) || (kind === "scene" && id === BOX)
    ? `https://example.test/${id}.png`
    : null;

const PUBLISHED: QuestionFields = { ...SAVED, isPublished: true };

describe("publishRefusal", () => {
  const NOTHING =
    "Para publicar, escolha a imagem (Palavra ou Cena) ou marque Encenar. Sem Publicada, a pergunta é salva como rascunho";
  const WORD =
    "A palavra escolhida não tem imagem aprovada. Para publicar, escolha outra com imagem ou marque Encenar. Sem Publicada, a pergunta é salva como rascunho";
  const SCENE =
    "A cena escolhida ainda não tem imagem aprovada. Para publicar, faça e aprove a imagem pelo link Fazer a imagem em Imagens, logo acima, ou marque Encenar. Sem Publicada, a pergunta é salva como rascunho";

  test("an unpublished question is saved whatever it shows", () => {
    for (const image of [
      { kind: "none" },
      { kind: "acted" },
      { kind: "word", id: SHELF },
      { kind: "scene", id: PEN },
    ] as const) {
      assert.equal(publishRefusal({ ...SAVED, image }, pictureOf), null);
    }
  });

  test("a published question acted out is saved", () => {
    assert.equal(
      publishRefusal({ ...PUBLISHED, image: { kind: "acted" } }, pictureOf),
      null,
    );
  });

  test("a published question with an approved picture is saved", () => {
    assert.equal(
      publishRefusal(
        { ...PUBLISHED, image: { kind: "word", id: LAMP } },
        pictureOf,
      ),
      null,
    );
    assert.equal(
      publishRefusal(
        { ...PUBLISHED, image: { kind: "scene", id: BOX } },
        pictureOf,
      ),
      null,
    );
  });

  test("a published question with no image decided is refused", () => {
    assert.equal(publishRefusal(PUBLISHED, pictureOf), NOTHING);
  });

  test("a published question showing a word with no picture is refused", () => {
    assert.equal(
      publishRefusal(
        { ...PUBLISHED, image: { kind: "word", id: SHELF } },
        pictureOf,
      ),
      WORD,
    );
  });

  test("a published question showing a scene with no picture is refused", () => {
    assert.equal(
      publishRefusal(
        { ...PUBLISHED, image: { kind: "scene", id: PEN } },
        pictureOf,
      ),
      SCENE,
    );
  });

  test("a word whose kind is not drawn has no picture, path or not", () => {
    // Built as the actions build it: the stored row through approvedPicture.
    const stored: PictureOf = (kind) =>
      kind === "word"
        ? approvedPicture({
            representation: "symbol",
            imageUrl: "words/shelf.png",
          })
        : null;
    assert.equal(
      publishRefusal(
        { ...PUBLISHED, image: { kind: "word", id: SHELF } },
        stored,
      ),
      WORD,
    );
  });
});

describe("failureMessage", () => {
  test("an error is its message", () => {
    assert.equal(failureMessage(new Error("fetch failed")), "fetch failed");
    assert.equal(failureMessage("plain"), "plain");
  });

  test("the redirect of an ended session is said in words", () => {
    // What next/navigation's redirect() throws: an error carrying a digest.
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/login;307;",
    });
    assert.equal(failureMessage(redirect), SESSION_ENDED);
  });

  test("the redirect of a teacher who does not write content says so", () => {
    // requireContentWriter sends her to /teacher (0043, #211): her session
    // is fine, and signing in again would not help.
    for (const type of ["replace", "push"]) {
      const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
        digest: `NEXT_REDIRECT;${type};/teacher;307;`,
      });
      assert.equal(failureMessage(redirect), CONTENT_WRITERS_ONLY);
    }
    const elsewhere = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/teacher/lesson;307;",
    });
    assert.equal(failureMessage(elsewhere), SESSION_ENDED);
  });
});

describe("the forms open in a point", () => {
  test("opening a second form leaves the first one open", () => {
    const open = opened(opened(new Set(), "a"), "b");
    assert.deepEqual([...open], ["a", "b"]);
  });

  test("closing one leaves the others", () => {
    const open = closed(new Set(["a", "b"]), "a");
    assert.deepEqual([...open], ["b"]);
  });

  test("neither changes the set it was given", () => {
    const before: ReadonlySet<string> = new Set(["a"]);
    opened(before, "b");
    closed(before, "a");
    assert.deepEqual([...before], ["a"]);
  });
});

describe("parseSuggestion", () => {
  const whole = {
    model: "claude-haiku-5-5",
    prompt: "Is it a pen?",
    answer: "Yes, it's a pen.",
  };

  test("nothing sent is a question written by hand", () => {
    assert.equal(parseSuggestion(undefined), null);
    assert.equal(parseSuggestion(null), null);
  });

  test("all three parts are taken, and nothing else rides along", () => {
    assert.deepEqual(parseSuggestion({ ...whole, is_published: true }), whole);
  });

  test("a part missing, blank, not text or too long is refused", () => {
    for (const part of ["model", "prompt", "answer"] as const) {
      assert.equal(parseSuggestion({ ...whole, [part]: undefined }), undefined);
      assert.equal(parseSuggestion({ ...whole, [part]: "  " }), undefined);
      assert.equal(parseSuggestion({ ...whole, [part]: 7 }), undefined);
      assert.equal(
        parseSuggestion({ ...whole, [part]: "x".repeat(1001) }),
        undefined,
      );
    }
    assert.equal(parseSuggestion("claude-haiku-5-5"), undefined);
  });

  test("the columns of the insert: all three, or all null by hand", () => {
    assert.deepEqual(suggestionColumns(whole), {
      suggested_model: "claude-haiku-5-5",
      suggested_prompt: "Is it a pen?",
      suggested_answer: "Yes, it's a pen.",
    });
    assert.deepEqual(suggestionColumns(null), {
      suggested_model: null,
      suggested_prompt: null,
      suggested_answer: null,
    });
  });
});
