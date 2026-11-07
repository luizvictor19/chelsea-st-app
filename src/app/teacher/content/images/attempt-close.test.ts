import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  closePending,
  failPending,
  storeGeneratedImage,
  type AttemptRow,
  type AttemptStore,
} from "./attempt-close.ts";

const OWNER = { kind: "word", id: "w1" } as const;
const ID = "a1";
const PATH = "w1/a1.png";
const EARLY = "2026-11-07T10:00:00.000Z";

type Row = AttemptRow & {
  completed_at: string | null;
  error: string | null;
  credits_spent: number | null;
};

/**
 * image_attempts reduced to the columns a close writes, with the update
 * filters applied the way PostgREST applies them: every filter has to match,
 * and a row no filter matches is left alone. The bucket is a set of paths.
 */
/** What the fake refuses, with the message Supabase would give. */
type Refusals = {
  update?: string;
  read?: (call: number) => string | null;
  upload?: string;
};

function store(row: Row, refuse: Refusals = {}) {
  let reads = 0;
  const rows = new Map<string, Row>([[ID, { ...row }]]);
  const files = new Set<string>(row.storage_path ? [row.storage_path] : []);
  let listed = 0;
  const db: AttemptStore = {
    update: (values) => {
      const filters: ((id: string, r: Row) => boolean)[] = [];
      const filter = {
        eq(column: "id" | "status", value: string) {
          filters.push((id, r) =>
            column === "id" ? id === value : r.status === value,
          );
          return filter;
        },
        async select() {
          if (refuse.update) {
            return { data: null, error: { message: refuse.update } };
          }
          const hit = [...rows].filter(([id, r]) =>
            filters.every((match) => match(id, r)),
          );
          for (const [id, r] of hit) rows.set(id, { ...r, ...values });
          return { data: hit.map(([id]) => ({ id })), error: null };
        },
      };
      return filter;
    },
    read: async (id) => {
      reads += 1;
      const refused = refuse.read?.(reads) ?? null;
      if (refused !== null) return { row: null, error: refused };
      const r = rows.get(id);
      return {
        row: r ? { status: r.status, storage_path: r.storage_path } : null,
        error: null,
      };
    },
    bucket: {
      upload: async (path) => {
        if (refuse.upload) return { error: { message: refuse.upload } };
        files.add(path);
        return { error: null };
      },
      remove: async (paths) => {
        for (const path of paths) files.delete(path);
        return { error: null };
      },
    },
    list: async () => {
      listed += 1;
      return [];
    },
    revalidate: () => {},
  };
  return {
    db,
    files,
    row: () => rows.get(ID)!,
    set: (fields: Partial<Row>) =>
      rows.set(ID, { ...rows.get(ID)!, ...fields }),
    listed: () => listed,
  };
}

const PENDING: Row = {
  status: "pending",
  storage_path: null,
  completed_at: null,
  error: null,
  credits_spent: 80,
};

const GENERATED: Row = {
  status: "generated",
  storage_path: PATH,
  completed_at: EARLY,
  error: null,
  credits_spent: 80,
};

function png(): Response {
  return new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

describe("a close lands only on a pending attempt (#151)", () => {
  test("a second finish on a generated attempt changes neither status nor completed_at", async () => {
    const s = store(GENERATED);

    const outcome = await closePending(s.db.update, ID, {
      status: "generated",
      storage_path: PATH,
    });

    assert.deepEqual(outcome, { closed: false, error: null });
    assert.equal(s.row().status, "generated");
    assert.equal(s.row().completed_at, EARLY);
  });

  test("a late failure does not turn a generated attempt into a failed one, and says no error", async () => {
    const s = store(GENERATED);

    const result = await failPending(
      s.db,
      ID,
      "Não deu para baixar a imagem: 403",
    );

    assert.equal(result.ok, true);
    assert.equal(s.row().status, "generated");
    assert.equal(s.row().error, null);
    assert.equal(s.row().completed_at, EARLY);
    assert.equal(s.listed(), 1, "answers with the list as it is");
  });

  test("a late poll does not take an approved attempt back to generated", async () => {
    const s = store(PENDING);

    // The other tab stores it and the teacher approves it while this poll
    // is still downloading.
    const result = await storeGeneratedImage(s.db, ID, OWNER, async () => {
      s.set({ ...GENERATED, status: "approved" });
      return png();
    });

    assert.equal(result.ok, true);
    assert.equal(s.row().status, "approved");
    assert.equal(s.row().completed_at, EARLY);
    assert.ok(s.files.has(PATH), "the approved picture's file stays");
  });

  test("a late poll after the discard does not bring the file back", async () => {
    const s = store(PENDING);

    // The other tab stores it and the teacher discards it (file gone, path
    // cleared) while this poll is still downloading.
    const result = await storeGeneratedImage(s.db, ID, OWNER, async () => {
      s.set({ ...GENERATED, status: "rejected", storage_path: null });
      s.files.delete(PATH);
      return png();
    });

    assert.equal(result.ok, true);
    assert.equal(s.row().status, "rejected");
    assert.equal(s.row().storage_path, null);
    assert.equal(s.files.has(PATH), false, "the discarded file is not back");
  });

  test("a poll that finds the attempt already closed downloads nothing", async () => {
    const s = store(GENERATED);
    let downloads = 0;

    const result = await storeGeneratedImage(s.db, ID, OWNER, async () => {
      downloads += 1;
      return png();
    });

    assert.equal(result.ok, true);
    assert.equal(downloads, 0);
    assert.equal(s.row().completed_at, EARLY);
  });
});

describe("a pending attempt still closes", () => {
  test("a generated picture is stored and the row closed with its path", async () => {
    const s = store(PENDING);

    const result = await storeGeneratedImage(s.db, ID, OWNER, async () =>
      png(),
    );

    assert.equal(result.ok, true);
    assert.equal(s.row().status, "generated");
    assert.equal(s.row().storage_path, PATH);
    assert.notEqual(s.row().completed_at, null);
    assert.equal(s.row().credits_spent, 80, "our figure is kept");
    assert.ok(s.files.has(PATH));
  });

  test("a failed download closes a pending row as failed, with the reason", async () => {
    const s = store(PENDING);

    const result = await storeGeneratedImage(
      s.db,
      ID,
      OWNER,
      async () => new Response(null, { status: 403 }),
    );

    assert.equal(result.ok, false);
    assert.equal(s.row().status, "failed");
    assert.equal(s.row().error, "Não deu para baixar a imagem: 403");
    assert.notEqual(s.row().completed_at, null);
  });

  test("a failure on a pending row is said to the screen", async () => {
    const s = store(PENDING);

    const result = await failPending(
      s.db,
      ID,
      "A geração falhou sem dizer por quê.",
    );

    assert.deepEqual(
      { ok: result.ok, error: result.ok ? null : result.error },
      { ok: false, error: "A geração falhou sem dizer por quê." },
    );
    assert.equal(s.row().status, "failed");
  });

  test("a provider figure for the credits wins over ours", async () => {
    const s = store(PENDING);

    await storeGeneratedImage(s.db, ID, OWNER, async () => png(), 95);

    assert.equal(s.row().credits_spent, 95);
  });
});

describe("an error on the way is said, and nothing is lost", () => {
  test("a row that cannot be read is said, and nothing is downloaded", async () => {
    const s = store(PENDING, { read: () => "connection reset" });
    let downloads = 0;

    const result = await storeGeneratedImage(s.db, ID, OWNER, async () => {
      downloads += 1;
      return png();
    });

    assert.deepEqual(result, { ok: false, error: "connection reset" });
    assert.equal(downloads, 0);
    assert.equal(s.row().status, "pending");
  });

  test("an upload refused closes the pending row as failed, with Storage's reason", async () => {
    const s = store(PENDING, { upload: "Payload too large" });

    const result = await storeGeneratedImage(s.db, ID, OWNER, async () =>
      png(),
    );

    assert.equal(result.ok, false);
    assert.equal(s.row().status, "failed");
    assert.equal(s.row().error, "Payload too large");
  });

  test("a close the database refuses is said, and the row stays pending", async () => {
    const s = store(PENDING, { update: "permission denied" });

    const result = await storeGeneratedImage(s.db, ID, OWNER, async () =>
      png(),
    );

    assert.deepEqual(result, { ok: false, error: "permission denied" });
    assert.equal(s.row().status, "pending");
    // The next poll stores again over the same path (uploadGenerated).
    assert.ok(s.files.has(PATH));
  });

  test("a failure the database refuses to write says both reasons", async () => {
    const s = store(PENDING, { update: "permission denied" });

    const result = await failPending(
      s.db,
      ID,
      "A geração terminou sem imagem.",
    );

    assert.equal(result.ok, false);
    assert.equal(
      result.ok ? null : result.error,
      "A geração terminou sem imagem. (permission denied)",
    );
  });

  test("a late poll whose second read fails leaves the file, which may be the row's", async () => {
    const s = store(PENDING, {
      read: (call) => (call === 2 ? "timeout" : null),
    });

    const result = await storeGeneratedImage(s.db, ID, OWNER, async () => {
      s.set({ ...GENERATED, status: "rejected", storage_path: null });
      s.files.delete(PATH);
      return png();
    });

    assert.equal(result.ok, true);
    assert.ok(s.files.has(PATH), "kept for a cleanup to find");
  });

  test("a picture that says nothing of its type is stored as png", async () => {
    const s = store(PENDING);

    await storeGeneratedImage(
      s.db,
      ID,
      OWNER,
      async () => new Response(new Uint8Array([1]), { status: 200 }),
    );

    assert.equal(s.row().storage_path, PATH);
  });

  test("a jpeg is stored under its own extension", async () => {
    const s = store(PENDING);

    await storeGeneratedImage(
      s.db,
      ID,
      OWNER,
      async () =>
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { "content-type": "image/jpeg; charset=binary" },
        }),
    );

    assert.equal(s.row().storage_path, "w1/a1.jpg");
  });
});
