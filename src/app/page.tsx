import { redirect } from "next/navigation";

import { resolveDestination } from "@/lib/auth";

/** The front door. Holds no content of its own, only sends people onward. */
export default async function HomePage() {
  redirect(await resolveDestination());
}
