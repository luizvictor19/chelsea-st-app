/**
 * "Sair da conta": a plain form POST to /auth/sign-out, so it works before
 * JavaScript loads and leaves the page as a real navigation (see the route).
 * No confirmation of its own: unsaved work is at the same risk as with any link
 * of the nav, and the questions screen, which warns on leaving, asks first.
 * "Da conta" because "Sair" already means leaving a screen elsewhere in
 * the teacher area (the session preview).
 */
export function SignOutButton() {
  return (
    <form method="post" action="/auth/sign-out">
      <button
        type="submit"
        className="text-muted hover:text-foreground cursor-pointer text-sm whitespace-nowrap transition-colors"
      >
        Sair da conta
      </button>
    </form>
  );
}
