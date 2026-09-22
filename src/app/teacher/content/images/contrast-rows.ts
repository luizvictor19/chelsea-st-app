import { requireTeacher } from "@/lib/content/queries";

import type { ContrastRow } from "./contrast-sets";

/**
 * Every member of every contrast set. The whole table and not the open
 * word's set: the picker has to say which set holds each word it lists, and
 * the sets are few (the book has a handful of families).
 */
export async function readContrastRows(): Promise<readonly ContrastRow[]> {
  const { supabase } = await requireTeacher();
  const { data, error } = await supabase
    .from("contrast_set_items")
    .select("set_id, vocabulary_item_id, position");
  if (error) throw new Error(error.message);
  return data;
}
