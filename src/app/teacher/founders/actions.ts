"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformAdmin } from "@/lib/auth";
import { readSeatsForm, sealRefusal } from "@/lib/founders/seats-form";

export type FounderState =
  | { status: "idle" }
  | { status: "saved"; message: string }
  | { status: "error"; message: string };

function refresh(): void {
  revalidatePath("/teacher/founders");
  revalidatePath("/dashboard/plano");
}

/**
 * The total of founder seats, with the platform admin's own client:
 * founder_program_insert and founder_program_update decide (0058). A total
 * below the live seals is accepted: no seal is lost, the seats left are 0.
 */
export async function saveSeats(
  _previous: FounderState,
  formData: FormData,
): Promise<FounderState> {
  const { supabase } = await requirePlatformAdmin();
  const read = readSeatsForm(formData);
  if (!read.ok) return { status: "error", message: read.message };
  const { error } = await supabase
    .from("founder_program")
    .upsert({ id: true, seats_total: read.seats }, { onConflict: "id" });
  if (error) return { status: "error", message: sealRefusal(error) };
  refresh();
  return { status: "saved", message: "Total de vagas salvo." };
}

/**
 * Gives the seal by hand, a repair (13/11): grant_badge refuses anyone but
 * the platform admin and, through badge_grant, a seal with no seat left.
 */
export async function grantSeal(
  _previous: FounderState,
  formData: FormData,
): Promise<FounderState> {
  const { supabase } = await requirePlatformAdmin();
  const person = String(formData.get("person_id") ?? "");
  if (person === "") return { status: "error", message: "Escolha a aluna." };
  const { error } = await supabase.rpc("grant_badge", {
    p_person: person,
    p_badge: "founder",
  });
  if (error) return { status: "error", message: sealRefusal(error) };
  refresh();
  return { status: "saved", message: "Selo dado." };
}

/**
 * Takes the seal back. The form sends confirm=sim only after the second,
 * labelled confirmation: it takes away, in silence for the person, the right
 * to subscribe to the Plano Fundador or come back to it. It cancels no
 * subscription and gives the seat back.
 */
export async function revokeSeal(
  _previous: FounderState,
  formData: FormData,
): Promise<FounderState> {
  const { supabase } = await requirePlatformAdmin();
  if (formData.get("confirm") !== "sim") return { status: "idle" };
  const person = String(formData.get("person_id") ?? "");
  const { data, error } = await supabase.rpc("revoke_badge", {
    p_person: person,
    p_badge: "founder",
  });
  if (error) return { status: "error", message: sealRefusal(error) };
  refresh();
  return data
    ? { status: "saved", message: "Selo tirado." }
    : {
        status: "error",
        message: "Essa pessoa já não tinha o selo. A lista foi atualizada.",
      };
}
