import { billingOpen } from "@/lib/billing/server";
import type { Site } from "@/lib/brand";
import { signupDoor, type SignupDoor } from "@/lib/signup";

/**
 * The door of /cadastro on this deployment, from the environment: the page,
 * its action and the link on /login read the same one.
 */
export function signupDoorHere(site: Site | null): SignupDoor {
  return signupDoor(site, {
    billing: billingOpen(),
    siteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    secretKey: process.env.TURNSTILE_SECRET_KEY,
  });
}
