/**
 * What a finished picture has to be before it enters as an attempt.
 *
 * Some pictures are made outside the platform, drawn on the Freepik site and
 * finished by hand, and the teacher sends the file itself. It becomes an
 * attempt like a generated one and is approved the same way, so the rules
 * here are about the file and the word, never about approval.
 *
 * Pure, so the panel and the action ask the same question: the panel before a
 * byte leaves the browser, the action again where it cannot be worked around.
 */

// The extension is required: isDrawableKind is a value, and this file is also
// loaded by node --test, which resolves no bare specifiers.
import { MAX_FILE_BYTES } from "./body-limit.ts";
import { isDrawableKind } from "./style.ts";

/**
 * The largest file accepted, the cap body-limit.ts holds every file to.
 *
 * The files expected are square PNGs of up to about 1800px and about 1 MB, so
 * the 2 MB there is twice what is expected.
 *
 * Nothing is shrunk in the browser. A reference is silhouette and can lose
 * resolution; this is the picture the student sees, and re-encoding it would
 * change the thing the teacher finished by hand.
 */
export const MAX_UPLOAD_BYTES = MAX_FILE_BYTES;

/**
 * The formats accepted, by content type, with the extension each is stored
 * under. No SVG: the bucket is public, and an SVG is a document that can
 * carry script. No GIF: nothing made for this needs one.
 */
const UPLOAD_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

export type UploadType = keyof typeof UPLOAD_TYPES;

/** What the file input asks the browser to offer. */
export const UPLOAD_ACCEPT = Object.keys(UPLOAD_TYPES).join(",");

function isUploadType(type: string): type is UploadType {
  return type in UPLOAD_TYPES;
}

export function uploadExtension(type: UploadType): string {
  return UPLOAD_TYPES[type];
}

/** How many leading bytes sniffImageType needs. */
export const SNIFF_BYTES = 12;

function startsWith(bytes: Uint8Array, signature: readonly number[], at = 0) {
  if (bytes.length < at + signature.length) return false;
  return signature.every((value, index) => bytes[at + index] === value);
}

/**
 * The real format of a file, read from its first bytes, or null.
 *
 * file.type is what the browser guessed from the name, and a file renamed by
 * hand says whatever its name says. The bytes are what the student's browser
 * will actually decode.
 */
export function sniffImageType(bytes: Uint8Array): UploadType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // RIFF, a four byte length, then WEBP. The tail is checked too, because
  // RIFF alone is also a WAVE or an AVI.
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
}

/** A size in megabytes as the screen writes it: "2", "2,5". */
export function megabytes(bytes: number): string {
  const value = Math.round((bytes / (1024 * 1024)) * 10) / 10;
  return String(value).replace(".", ",");
}

/**
 * The limit as the panel and the refusal say it, read off the constant so the
 * sentence cannot go on saying 2 MB after the number has moved.
 */
export const UPLOAD_LIMIT_LABEL = `${megabytes(MAX_UPLOAD_BYTES)} MB`;

/** The sentence for a file over the limit, with its size, never rounded down. */
export function tooBig(size: number): string {
  // Up to the next tenth, so a file just over the limit never reads as the
  // limit. The epsilon keeps an exact tenth from being pushed up a step by
  // floating point.
  const tenths = Math.ceil((size / (1024 * 1024)) * 10 - 1e-9) / 10;
  const shown = tenths.toFixed(1).replace(".", ",");
  return `Arquivo grande demais (${shown} MB). O limite é ${UPLOAD_LIMIT_LABEL}.`;
}

/**
 * The name to record for a file, or null when it came with none.
 *
 * "blob" is the name FormData gives a Blob that had none, so it names no file
 * the teacher could recognise, and recording it would put "enviada · blob"
 * on a row where there is nothing honest to say.
 */
export function uploadFilename(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed === "blob") return null;
  return trimmed;
}

/**
 * Why a file cannot be sent for this word, or null when it can.
 *
 * `type` is the declared one, file.type. An empty one passes, since some
 * systems give none, and the bytes decide in the action. `kind` is the word's
 * representation.
 *
 * The file is judged before the word, so a file that is too big is told so
 * whatever the word is: that is the one thing the teacher has to fix
 * elsewhere.
 */
export function refuseUpload(file: {
  readonly size: number;
  readonly type: string;
  readonly kind: string | null;
}): string | null {
  if (file.size === 0) return "O arquivo está vazio.";
  if (file.size > MAX_UPLOAD_BYTES) return tooBig(file.size);
  if (file.type !== "" && !isUploadType(file.type)) {
    return "Envie um arquivo PNG, JPEG ou WebP.";
  }
  if (file.kind === null) {
    return "Escolha o tipo da palavra antes de enviar a imagem.";
  }
  if (!isDrawableKind(file.kind)) {
    return "Este tipo de palavra não leva imagem.";
  }
  return null;
}

/**
 * The body to hand storage for a file: its bytes, never the File itself.
 *
 * storage-js wraps a Blob in FormData and sends it with the type the browser
 * declared, dropping the contentType it was given (index.mjs, uploadOrUpdate,
 * read on 2026-09-23). Bytes go out with the contentType as the header, so
 * the bucket serves the type sniffImageType read, not the one the name
 * implied.
 */
export async function storageBody(file: Blob): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

/**
 * What an action answers once its write has landed.
 *
 * The list is read again so the panel has proof the call came back. If only
 * that read fails, the upload still happened: answering with a failure would
 * have the teacher send the file again and find it there twice. So the
 * answer is a success without a list, which the panel reads as "keep what
 * you have", and the re-render revalidatePath sends brings the new row.
 */
export async function afterWrite<T>(
  read: () => Promise<T>,
): Promise<{ ok: true; attempts?: T }> {
  try {
    return { ok: true, attempts: await read() };
  } catch {
    return { ok: true };
  }
}
