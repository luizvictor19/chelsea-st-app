/**
 * The e-mails to Luiz about an error (#69), sent through the app's Resend
 * mailer from alertas@. What they carry was scrubbed before (scrub.ts):
 * the message, the route, the release, the digest, the count and when, and
 * the query that shows the row through the MCP. No stack: it stays in the
 * database, where the platform admin reads it on /teacher/monitoring.
 */

import type { Email } from "../mail/mailer.ts";

import type { CleanError, Recorded } from "./report.ts";

const SUBJECT_MESSAGE = 80;

function oneLine(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

function inBrasilia(instant: string | number): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(instant));
}

export function errorAlertEmail(
  to: string,
  error: CleanError,
  recorded: Recorded,
): Email {
  const subject = recorded.overflow
    ? "[erro] mais de 200 erros diferentes hoje"
    : `[erro] ${error.kind} ${error.route}: ${oneLine(error.message, SUBJECT_MESSAGE)}`;
  const fingerprint = recorded.overflow ? "overflow" : error.fingerprint;
  const lines = [
    recorded.overflow
      ? "Hoje passou de 200 erros diferentes. Os novos só são contados na linha overflow, e nenhum outro alerta sai até amanhã (UTC)."
      : "Um erro novo hoje no app.",
    "",
    `Tipo: ${error.kind}`,
    `Rota: ${error.route}`,
    `Mensagem: ${error.message}`,
    `Release: ${error.release ?? "(sem release)"}`,
    `Digest: ${error.digest ?? "(sem digest)"}`,
    `Vezes hoje: ${recorded.count}`,
    `Primeira vez: ${inBrasilia(recorded.firstAt)} (horário de Brasília)`,
    "",
    "A linha no banco, pelo MCP:",
    `select * from app_errors where fingerprint = '${fingerprint}' and day = '${recorded.day}';`,
    "",
    "Todos os erros dos últimos 30 dias: /teacher/monitoring.",
  ];
  return {
    to,
    subject,
    text: lines.join("\n"),
    // Resend sends one e-mail per key in 24 h: a retry of the same report
    // sends nothing new.
    idempotencyKey: `app-error-${fingerprint}-${recorded.day}`,
  };
}

/**
 * The database did not answer while recording an error: paused (Supabase
 * Free pauses after 7 days without use), a wrong key, the network. Sent
 * without the database, at most once every 15 minutes per instance, and once
 * per quarter of an hour across instances by its key.
 */
export function databaseDownEmail(
  to: string,
  error: CleanError,
  reason: string,
  now: number,
): Email {
  const quarter = Math.floor(now / (15 * 60 * 1000));
  return {
    to,
    subject: "[erro] o banco não respondeu ao registrar um erro",
    text: [
      "O banco não respondeu ao registrar um erro do app. Pode ser a pausa do Supabase Free (7 dias sem uso), uma chave errada ou a rede.",
      "",
      `Quando: ${inBrasilia(now)} (horário de Brasília)`,
      `Resposta do banco: ${reason}`,
      "",
      "O erro que não foi registrado:",
      `Tipo: ${error.kind}`,
      `Rota: ${error.route}`,
      `Mensagem: ${error.message}`,
      `Release: ${error.release ?? "(sem release)"}`,
      "",
      "Outro aviso igual só sai daqui a 15 minutos.",
    ].join("\n"),
    idempotencyKey: `app-error-database-down-${quarter}`,
  };
}
