import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import {
  expiresAt,
  founderInviteRefusal,
  inviteFounder,
  NOT_MAILED,
  readFounderInviteForm,
  UNCHECKED,
  type FounderInviteDeps,
} from "./founder-invite.ts";
import {
  founderInviteEmail,
  founderSignupLink,
  readSignupFragment,
} from "./founder-invite-mail.ts";
import type { Email, Mailer } from "./mail/mailer.ts";

const NOW = new Date("2026-11-13T12:00:00Z");
const ORIGIN = "https://app.example.com";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

let rows: { email: string; expires_at: string }[];
let sent: Email[];
let lines: string[];
let mailFails: boolean;

const mailer: Mailer = {
  async send(email) {
    if (mailFails) throw new Error("Resend is down");
    sent.push(email);
  },
};

function deps(over: Partial<FounderInviteDeps> = {}): FounderInviteDeps {
  return {
    insert: async (row) => {
      rows.push(row);
      return { ok: true, id: "invite-1" };
    },
    accepted: async () => false,
    mailer,
    origin: ORIGIN,
    now: () => NOW,
    ...over,
  };
}

beforeEach(() => {
  rows = [];
  sent = [];
  lines = [];
  mailFails = false;
});

describe("readFounderInviteForm", () => {
  test("the e-mail made normal and the days", () => {
    assert.deepEqual(
      readFounderInviteForm(form({ email: " Ana@Example.com ", days: "15" })),
      {
        ok: true,
        values: { email: "ana@example.com", days: 15 },
      },
    );
  });

  test("refuses an e-mail that is not one, and days out of 1 to 90", () => {
    assert.equal(
      readFounderInviteForm(form({ email: "ana", days: "15" })).ok,
      false,
    );
    for (const days of ["0", "91", "", "2.5"]) {
      assert.equal(
        readFounderInviteForm(form({ email: "a@b.co", days })).ok,
        false,
        days,
      );
    }
  });
});

describe("the validity", () => {
  test("now plus the days", () => {
    assert.equal(expiresAt(NOW, 15), "2026-11-28T12:00:00.000Z");
  });
});

describe("inviteFounder", () => {
  test("writes the invite, mails it from the signup link, and shows the link", async () => {
    const state = await inviteFounder(
      deps(),
      form({ email: "Ana@Example.com", days: "15" }),
    );
    assert.deepEqual(rows, [
      { email: "ana@example.com", expires_at: "2026-11-28T12:00:00.000Z" },
    ]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].subject, "Você foi convidada como fundadora");
    assert.deepEqual(state, {
      status: "sent",
      email: "ana@example.com",
      granted: false,
      link: founderSignupLink(ORIGIN, "ana@example.com"),
    });
  });

  test("an account already confirmed: the seal was given, and the e-mail says so", async () => {
    const state = await inviteFounder(
      deps({ accepted: async () => true }),
      form({ email: "ana@example.com", days: "15" }),
    );
    assert.equal(sent[0].subject, "Você ganhou o selo de fundadora");
    assert.equal(state.status === "sent" && state.granted, true);
    assert.equal(state.status === "sent" && state.link, `${ORIGIN}/login`);
  });

  test("with Resend down the invite is kept, and the link is shown to send by hand", async () => {
    mailFails = true;
    const state = await inviteFounder(
      deps(),
      form({ email: "ana@example.com", days: "15" }),
      (line) => lines.push(line),
    );
    assert.equal(rows.length, 1);
    assert.equal(state.status, "unsent");
    assert.equal(
      state.status === "unsent" && state.link,
      founderSignupLink(ORIGIN, "ana@example.com"),
    );
    assert.deepEqual(lines, ["founder invite mail failed: Error"]);
    assert.ok(!lines.join(" ").includes("ana@"));
  });

  test("with no key or no site, nothing is sent and the screen says so", async () => {
    const noKey = await inviteFounder(
      deps({ mailer: null }),
      form({ email: "a@b.co", days: "1" }),
      (l) => lines.push(l),
    );
    assert.equal(noKey.status, "unsent");
    const noSite = await inviteFounder(
      deps({ origin: null }),
      form({ email: "c@d.co", days: "1" }),
      (l) => lines.push(l),
    );
    assert.equal(noSite.status === "unsent" && noSite.link, null);
    assert.equal(sent.length, 0);
    assert.equal(NOT_MAILED.includes("link"), true);
  });

  test("when the acceptance cannot be read, nothing is mailed, and the screen says so", async () => {
    const state = await inviteFounder(
      deps({ accepted: async () => null }),
      form({ email: "ana@example.com", days: "15" }),
    );
    assert.equal(sent.length, 0);
    assert.equal(rows.length, 1);
    assert.equal(state.status === "unsent" && state.message, UNCHECKED);
  });

  test("a refused write is said and nothing is mailed", async () => {
    const state = await inviteFounder(
      deps({
        insert: async () => ({
          ok: false,
          error: {
            code: "23514",
            message: "founder_seats_available: no founder seat is left",
          },
        }),
      }),
      form({ email: "ana@example.com", days: "15" }),
    );
    assert.deepEqual(state, {
      status: "error",
      message: "Não há vagas de fundador. Aumente o total em Fundadores.",
    });
    assert.equal(sent.length, 0);
  });

  test("a form refused writes nothing", async () => {
    const state = await inviteFounder(deps(), form({ email: "x", days: "15" }));
    assert.equal(state.status, "error");
    assert.equal(rows.length, 0);
  });
});

describe("founderInviteRefusal", () => {
  test("no seat, an invite already open, someone else, anything else", () => {
    assert.match(
      founderInviteRefusal({ message: "founder_seats_available: x" }),
      /vagas/,
    );
    assert.match(founderInviteRefusal({ code: "23505" }), /Reenviar/);
    assert.match(founderInviteRefusal({ code: "42501" }), /Só o admin/);
    assert.match(founderInviteRefusal({}), /Tente de novo/);
  });
});

describe("the founder invite e-mail", () => {
  test("the address rides in the fragment of the link, never in its query", () => {
    const url = new URL(founderSignupLink(ORIGIN, "ana+fundadora@example.com"));
    assert.equal(url.pathname, "/cadastro");
    assert.equal(url.search, "");
    assert.equal(url.hash, "#fundador&email=ana%2Bfundadora%40example.com");
  });

  test("from agenda@, with no number in its text", () => {
    for (const granted of [false, true]) {
      const email = founderInviteEmail({
        to: "ana@example.com",
        origin: ORIGIN,
        granted,
      });
      assert.equal(email.to, "ana@example.com");
      assert.equal(email.replyTo, "agenda@chelsea-st.com");
      assert.doesNotMatch(email.text.replace(/https?:\S+/g, ""), /\d/);
    }
  });

  test("the invite says the seal comes with the confirmation, and links the signup", () => {
    const email = founderInviteEmail({
      to: "ana@example.com",
      origin: ORIGIN,
      granted: false,
    });
    assert.match(email.text, /o selo entra quando você confirmar o e-mail/);
    assert.ok(
      email.text.includes(founderSignupLink(ORIGIN, "ana@example.com")),
    );
  });
});

describe("readSignupFragment", () => {
  test("a founder invite: the address and the mark", () => {
    assert.deepEqual(
      readSignupFragment("#fundador&email=ana%2Bf%40example.com"),
      {
        email: "ana+f@example.com",
        founder: true,
      },
    );
  });

  test("a personal plan's link: the address only", () => {
    assert.deepEqual(readSignupFragment("#email=ana%40example.com"), {
      email: "ana@example.com",
      founder: false,
    });
  });

  test("nothing", () => {
    assert.deepEqual(readSignupFragment(""), { email: null, founder: false });
    assert.deepEqual(readSignupFragment("#email="), {
      email: null,
      founder: false,
    });
  });
});
