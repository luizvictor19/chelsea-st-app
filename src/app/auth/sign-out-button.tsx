import { signOut } from "./actions";

/**
 * "Sair", as a form so it works before JavaScript loads. No confirmation:
 * nothing saved is lost, and signing back in is one password away.
 */
export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="text-muted hover:text-foreground cursor-pointer text-sm whitespace-nowrap transition-colors"
      >
        Sair
      </button>
    </form>
  );
}
