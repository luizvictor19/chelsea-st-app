/**
 * The approved pictures a scene is drawn from (#120), as the screen names
 * them: "word:{id}" or "scene:{id}", in the order chosen. The server reads
 * each one's path from its row, never from the browser.
 */

import { COMPOSE_MAX } from "./provider.ts";

export type PictureSource = {
  readonly kind: "word" | "scene";
  readonly id: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** One key, or null for anything that is not one. */
export function parsePictureKey(key: string): PictureSource | null {
  const separator = key.indexOf(":");
  const kind = key.slice(0, separator);
  const id = key.slice(separator + 1);
  if (separator < 0 || (kind !== "word" && kind !== "scene")) return null;
  return UUID.test(id) ? { kind, id } : null;
}

/**
 * The whole list, or the sentence the teacher reads: 1 to COMPOSE_MAX, each
 * a key, none twice, and not the scene being drawn.
 */
export function parsePictureKeys(
  keys: readonly string[],
  sceneId: string,
): { ok: true; sources: PictureSource[] } | { ok: false; error: string } {
  if (keys.length === 0 || keys.length > COMPOSE_MAX) {
    return {
      ok: false,
      error: `Escolha de 1 a ${COMPOSE_MAX} imagens aprovadas.`,
    };
  }
  if (new Set(keys).size !== keys.length) {
    return { ok: false, error: "A mesma imagem foi escolhida duas vezes." };
  }
  const sources: PictureSource[] = [];
  for (const key of keys) {
    const source = parsePictureKey(key);
    if (source === null) {
      return { ok: false, error: "Uma das imagens escolhidas não existe." };
    }
    if (source.kind === "scene" && source.id === sceneId) {
      return {
        ok: false,
        error: "Uma cena não pode ser desenhada a partir dela mesma.",
      };
    }
    sources.push(source);
  }
  return { ok: true, sources };
}
