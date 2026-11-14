import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createResendMailer, MailRefused } from "./mailer.ts";

type Call = { url: string; init: RequestInit };

/** A fetch that records each call and answers with the given response. */
function fakeFetch(answer: () => Response): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ url: String(url), init: init ?? {} });
    return answer();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const CONFIG = { apiKey: "re_test", from: "Agenda <agenda@example.com>" };

describe("createResendMailer", () => {
  test("refuses an empty key before any call", () => {
    assert.throws(
      () => createResendMailer({ apiKey: "", from: CONFIG.from }),
      /RESEND_API_KEY is empty/,
    );
  });

  test("a plain e-mail sends from, to, subject and text, and nothing else", async () => {
    const { fetchImpl, calls } = fakeFetch(() => Response.json({ id: "x" }));
    await createResendMailer(CONFIG, fetchImpl).send({
      to: "a@example.com",
      subject: "Assunto",
      text: "Corpo",
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.resend.com/emails");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer re_test");
    assert.equal("idempotency-key" in headers, false);
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      from: CONFIG.from,
      to: ["a@example.com"],
      subject: "Assunto",
      text: "Corpo",
    });
  });

  test("the reply-to, the attachments and the idempotency key go as Resend names them", async () => {
    const { fetchImpl, calls } = fakeFetch(() => Response.json({ id: "x" }));
    await createResendMailer(CONFIG, fetchImpl).send({
      to: "a@example.com",
      subject: "Assunto",
      text: "Corpo",
      replyTo: "agenda@example.com",
      attachments: [
        {
          filename: "invite.ics",
          content: "QkVHSU4=",
          contentType: "text/calendar; method=REQUEST",
        },
      ],
      idempotencyKey: "lesson-1-request-student",
    });
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers["idempotency-key"], "lesson-1-request-student");
    const body = JSON.parse(String(calls[0].init.body));
    assert.equal(body.reply_to, "agenda@example.com");
    assert.deepEqual(body.attachments, [
      {
        filename: "invite.ics",
        content: "QkVHSU4=",
        content_type: "text/calendar; method=REQUEST",
      },
    ]);
  });

  test("a refusal throws MailRefused with the status and Resend's name of the error", async () => {
    const { fetchImpl } = fakeFetch(() =>
      Response.json(
        { statusCode: 422, name: "validation_error", message: "bad to" },
        { status: 422 },
      ),
    );
    await assert.rejects(
      createResendMailer(CONFIG, fetchImpl).send({
        to: "a@example.com",
        subject: "s",
        text: "t",
      }),
      (error: unknown) =>
        error instanceof MailRefused &&
        error.status === 422 &&
        error.kind === "validation_error" &&
        /Resend refused: 422/.test(error.message),
    );
  });

  test("a body that is not Resend's JSON gives the kind unknown", async () => {
    for (const body of ["<html>bad gateway</html>", '{"name":"Not A Name!"}']) {
      const { fetchImpl } = fakeFetch(
        () => new Response(body, { status: 502 }),
      );
      await assert.rejects(
        createResendMailer(CONFIG, fetchImpl).send({
          to: "a@example.com",
          subject: "s",
          text: "t",
        }),
        (error: unknown) =>
          error instanceof MailRefused &&
          error.status === 502 &&
          error.kind === "unknown",
      );
    }
  });
});
