/**
 * The CPF, read and kept as little as possible.
 *
 * The provider needs the CPF itself to bill a person; this app needs only to
 * know whether it has seen that CPF before (one trial per CPF, Q4 of the #72
 * plan). So the app keeps an HMAC of it, keyed by BILLING_CPF_KEY, and never
 * the digits. Not a plain hash: there are about a billion valid CPFs, few
 * enough to hash them all and read a plain hash back.
 */

import { createHmac } from "node:crypto";

/** The eleven digits, with dots, dash and spaces gone; null when not eleven. */
export function cpfDigits(input: string): string | null {
  const digits = input.replace(/[\s.\-/]/g, "");
  return /^[0-9]{11}$/.test(digits) ? digits : null;
}

function checkDigit(digits: string, length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += Number(digits[i]) * (length + 1 - i);
  }
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

/**
 * Whether the digits are a CPF: both check digits right, and not one digit
 * repeated eleven times, which passes the check digits and is no one's.
 */
export function isValidCpf(input: string): boolean {
  const digits = cpfDigits(input);
  if (digits === null || /^(\d)\1{10}$/.test(digits)) return false;
  return (
    checkDigit(digits, 9) === Number(digits[9]) &&
    checkDigit(digits, 10) === Number(digits[10])
  );
}

/** HMAC-SHA256 of the digits, in hex: the only form of the CPF kept here. */
export function cpfHmac(input: string, key: string): string {
  const digits = cpfDigits(input);
  if (digits === null) throw new Error("Not a CPF");
  if (key.length < 32) {
    throw new Error("BILLING_CPF_KEY must have at least 32 characters");
  }
  return createHmac("sha256", key).update(digits).digest("hex");
}
