/**
 * Sending an e-mail, behind an interface, and the one implementation: the
 * Resend API, with the app's own key (RESEND_API_KEY), separate from the one
 * Supabase uses for its auth e-mails so each rotates alone (#72, Q5). Two
 * senders use it: the billing e-mails and the calendar invites (#294).
 */

/** A file sent with the e-mail, its bytes in base64. */
export type Attachment = {
  readonly filename: string;
  readonly content: string;
  readonly contentType: string;
};

export type Email = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly replyTo?: string;
  readonly attachments?: readonly Attachment[];
  /**
   * Resend sends one e-mail per key in 24 h: a second call with the same key
   * gets the first answer back and sends nothing.
   */
  readonly idempotencyKey?: string;
};

export interface Mailer {
  send(email: Email): Promise<void>;
}

/**
 * Resend said no. The status and Resend's own name of the error (such as
 * validation_error) carry no address and no name, so they may be logged and
 * stored; the message keeps the detail and stays out of the logs of the
 * calendar invites.
 */
export class MailRefused extends Error {
  readonly status: number;
  readonly kind: string;

  constructor(status: number, kind: string, detail: string) {
    super(`Resend refused: ${status} ${detail}`);
    this.name = "MailRefused";
    this.status = status;
    this.kind = kind;
  }
}

const ENDPOINT = "https://api.resend.com/emails";

/** Resend's name of the error, from its JSON body, or "unknown". */
function errorKind(detail: string): string {
  try {
    const name: unknown = JSON.parse(detail)?.name;
    return typeof name === "string" && /^[a-z_]{1,60}$/.test(name)
      ? name
      : "unknown";
  } catch {
    return "unknown";
  }
}

export function createResendMailer(
  config: { apiKey: string; from: string },
  fetchImpl: typeof fetch = fetch,
): Mailer {
  if (config.apiKey === "") throw new Error("RESEND_API_KEY is empty");
  return {
    async send(email) {
      const headers: Record<string, string> = {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      };
      if (email.idempotencyKey !== undefined) {
        headers["idempotency-key"] = email.idempotencyKey;
      }
      const response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({
          from: config.from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
          ...(email.replyTo === undefined ? {} : { reply_to: email.replyTo }),
          ...(email.attachments === undefined
            ? {}
            : {
                attachments: email.attachments.map((a) => ({
                  filename: a.filename,
                  content: a.content,
                  content_type: a.contentType,
                })),
              }),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new MailRefused(
          response.status,
          errorKind(detail),
          detail.slice(0, 200),
        );
      }
    },
  };
}
