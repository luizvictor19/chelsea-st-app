/**
 * How much a file sent to a server action may weigh, said once.
 *
 * Next caps a server action body at 1 MB unless told otherwise
 * (action-handler.js, 1024 * 1024), and refuses a bigger one with a 413 that
 * reaches the panel as "A resposta do servidor não chegou", the sentence for
 * a lost connection, on a file that was merely too big. So the frame is
 * raised in next.config.ts to BODY_SIZE_LIMIT_BYTES, read from here, and
 * every file is held to MAX_FILE_BYTES below it: the limit that says no has
 * to be ours, and it has to say why.
 *
 * Both paths that send a file share the cap, the structure reference and the
 * finished picture, because both are held under the same frame.
 *
 * No imports, so next.config.ts can read it without pulling the app in.
 */

/** The largest file either path accepts, 2 MB. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * serverActions.bodySizeLimit, 3 MB: wider than the cap, so the frame is
 * never the thing that fires. Under the 4.5 MB Vercel takes in a request.
 */
export const BODY_SIZE_LIMIT_BYTES = 3 * 1024 * 1024;
