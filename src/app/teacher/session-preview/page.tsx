import type { Metadata } from "next";

import { listVocabularyImages } from "@/lib/content/queries";
import type { SessionWord } from "@/lib/tutor/turn-engine";

import { FakeSession } from "./fake-session";

export const metadata: Metadata = {
  title: "Prévia da sessão · Chelsea St",
};

/** How many words the fake script walks through. */
const PREVIEW_WORDS = 5;

/**
 * A preview of the voice tutor's session screen, with a fake turn behind it.
 * It lives under /teacher so the student never lands on the prototype; the role
 * check is the teacher layout's.
 *
 * The words are the first of lesson 1, in book order, that already have an
 * approved picture, read through the same query as the images screen.
 */
export default async function SessionPreviewPage() {
  const { lessons } = await listVocabularyImages();
  const words: SessionWord[] = (
    lessons.find((lesson) => lesson.lessonNumber === 1)?.words ?? []
  )
    .flatMap((word) =>
      word.imageUrl === null
        ? []
        : [{ term: word.term, imageUrl: word.imageUrl }],
    )
    .slice(0, PREVIEW_WORDS);

  if (words.length === 0) {
    return (
      <p className="text-muted max-w-prose">
        A lição 1 ainda não tem nenhuma palavra com imagem aprovada, então não
        há o que mostrar na prévia.
      </p>
    );
  }

  return <FakeSession words={words} />;
}
