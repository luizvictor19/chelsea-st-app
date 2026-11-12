/**
 * Sending an e-mail, behind an interface, and the one implementation: the
 * Resend API, with the app's own key (RESEND_API_KEY), separate from the one
 * Supabase uses for its auth e-mails so each rotates alone (#72, Q5).
 */

export type Email = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
};

export interface Mailer {
  send(email: Email): Promise<void>;
}

const ENDPOINT = "https://api.resend.com/emails";

export function createResendMailer(
  config: { apiKey: string; from: string },
  fetchImpl: typeof fetch = fetch,
): Mailer {
  if (config.apiKey === "") throw new Error("RESEND_API_KEY is empty");
  return {
    async send(email) {
      const response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: config.from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Resend refused: ${response.status} ${detail.slice(0, 200)}`,
        );
      }
    },
  };
}
