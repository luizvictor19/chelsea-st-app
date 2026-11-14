"use server";

import { headers } from "next/headers";
import { after } from "next/server";

import { normalizeEmail } from "@/lib/credentials";
import { currentSite } from "@/lib/current-site";
import type { LinkRequestState } from "@/lib/link-request";
import { signupCoupon } from "@/lib/founder-coupon";
import {
  requestSignup,
  signupName,
  signupOrigin,
  signupSend,
} from "@/lib/signup";
import { createInviteMailer } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { TOKEN_FIELD, verifyChallenge } from "@/lib/turnstile";

import { signupDoorHere } from "./door";

// The name, the address and the coupon go back to the form on an error: React
// resets the fields when the action ends.
export type SignupState =
  | { status: "idle" }
  | Extract<LinkRequestState, { status: "sent" }>
  | {
      status: "error";
      message: string;
      name: string;
      email: string;
      coupon: string;
    };

/**
 * The signup of the chelsea-st brand (#275): an invite the person asks for herself.
 *
 * Refuses on the screen only what does not depend on the account: the door
 * (only the chelsea-st site, only while open), the name, the address and the
 * anti-robot challenge. Past them every address reads "sent", at once, and
 * the email goes out after the response (src/lib/signup.ts,
 * src/lib/link-request.ts): a new address gets the signup email, a confirmed
 * account the link to sign in, an unconfirmed one its email again.
 *
 * The site, the mailer and the client are built before the answer: inside
 * `after` the request is over.
 *
 * A founder coupon and the origin ride into the metadata (#296, 0059) and
 * are dealt with by the first confirmation. The answer is the same with any
 * coupon, good or not: the anonymous form says nothing about a code.
 */
export async function signUp(
  _previous: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const site = await currentSite();
  const door = signupDoorHere(site);
  const name = signupName(formData.get("name"));
  const email = normalizeEmail(formData.get("email"));
  const coupon = signupCoupon(formData.get("founder_coupon"));
  const origin = signupOrigin(formData.get("origin"));
  if (door !== "open") {
    return {
      status: "error",
      message: "As inscrições ainda não abriram por aqui.",
      name,
      email,
      coupon,
    };
  }

  const token = formData.get(TOKEN_FIELD);
  // The first address is the client's on Vercel; optional for Cloudflare.
  const remoteIp =
    (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  const mailer = createInviteMailer();
  const supabase = await createClient();

  const state = await requestSignup({
    name,
    email,
    challenge: () =>
      verifyChallenge({
        secret: process.env.TURNSTILE_SECRET_KEY,
        token,
        remoteIp,
        fetch,
      }),
    send: () =>
      signupSend(
        email,
        name,
        site,
        {
          invite: (address, options) =>
            mailer.inviteUserByEmail(address, options),
          magicLink: (address, options) =>
            supabase.auth.signInWithOtp({ email: address, options }),
        },
        { coupon, origin },
      ),
    schedule: after,
    log: console,
  });
  return state.status === "error" ? { ...state, name, email, coupon } : state;
}
