import Link from "next/link";

import type { SceneImage } from "@/lib/content/queries";

import { ArchiveScene } from "./archive-scene";
import { filterHref, sceneSituation, type Selection } from "./filters";
import { NewScene } from "./new-scene";
import { groupLabel, type SceneGroup } from "./scenes";
import { StatusMark } from "./status-mark";

/**
 * Cenas (#64): every scene under the point of the first question that shows
 * it, with Nova cena on top. Below the lessons, in the same column, because a
 * scene is opened in the same panel a word is.
 *
 * The count is over every scene, as a lesson's is over every word: what the
 * filter shows does not change how many still owe a picture.
 */
export function ScenesSection({
  groups,
  withImage,
  total,
  selection,
  term,
  openId,
}: {
  readonly groups: readonly SceneGroup<SceneImage>[];
  readonly withImage: number;
  readonly total: number;
  readonly selection: Selection;
  readonly term: string;
  readonly openId: string | null;
}) {
  return (
    <section id="cenas" aria-label="Cenas" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <h2 className="text-faint mr-auto font-mono text-xs tracking-[0.16em] uppercase">
          Cenas
        </h2>
        <span className="text-faint text-xs whitespace-nowrap">
          {withImage}/{total} com imagem
        </span>
      </div>
      <NewScene selection={selection} term={term} />
      {total === 0 && (
        <p className="text-muted text-sm">
          Nenhuma cena ainda. Uma cena é uma imagem com assunto próprio, como
          &quot;a big box&quot;, que mais de uma pergunta pode usar.
        </p>
      )}
      {groups.map((group) => (
        <div key={group.point ?? "sem-pergunta"} className="flex flex-col">
          <h3 className="text-faint px-3 pt-2 pb-1 font-mono text-xs">
            {groupLabel(group.point)}
          </h3>
          <ul className="flex flex-col">
            {group.scenes.map((scene) => (
              <li key={scene.id} className="flex min-w-0 items-center gap-1">
                <Link
                  href={filterHref(
                    selection,
                    { kind: "scene", id: scene.id },
                    term,
                  )}
                  aria-current={openId === scene.id ? "true" : undefined}
                  className={
                    openId === scene.id
                      ? "bg-surface border-rule flex min-w-0 flex-1 items-center justify-between gap-3 rounded-sm border px-3 py-2"
                      : "border-rule hover:bg-surface flex min-w-0 flex-1 items-center justify-between gap-3 rounded-sm border border-transparent px-3 py-2 transition-colors"
                  }
                >
                  <span className="truncate font-semibold">
                    {scene.description}
                  </span>
                  <StatusMark situation={sceneSituation(scene.imageUrl)} />
                </Link>
                {/* Beside the link, never in it: a click here opens nothing. */}
                <ArchiveScene
                  scene={scene}
                  closeHref={
                    openId === scene.id
                      ? filterHref(selection, null, term)
                      : null
                  }
                  variant="icon"
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
