"use server";

import { requirePlatformAdmin } from "@/lib/auth";

import { TEST_MESSAGE } from "./test-message";

/**
 * "Erro de teste no servidor" (#69): an action that throws, for the platform
 * admin alone, so onRequestError records it and the e-mail goes out. One row
 * a day however many times it is pressed.
 */
export async function throwServerTestError(): Promise<void> {
  await requirePlatformAdmin();
  throw new Error(TEST_MESSAGE);
}
