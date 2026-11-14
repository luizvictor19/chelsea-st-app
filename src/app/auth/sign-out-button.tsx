/**
 * "Sair da conta": a plain form POST to /auth/sign-out, so it works before
 * JavaScript loads and leaves the page as a real navigation (see the route).
 * No confirmation of its own: unsaved work is at the same risk as with any link
 * of the nav, and the questions screen, which warns on leaving, asks first.
 * "Da conta" because "Sair" already means leaving a screen elsewhere in
 * the teacher area (the session preview).
 *
 * The teacher menu draws it as one of its items (an icon, and the words or a
 * label for them), so it passes its own look and contents; every other screen
 * takes the plain words.
 */
export function SignOutButton({
  className = "text-muted hover:text-foreground cursor-pointer text-sm whitespace-nowrap transition-colors",
  label,
  children = "Sair da conta",
}: {
  readonly className?: string;
  /** The accessible name when the contents are an icon alone. */
  readonly label?: string;
  readonly children?: React.ReactNode;
} = {}) {
  return (
    <form method="post" action="/auth/sign-out">
      <button
        type="submit"
        aria-label={label}
        title={label}
        className={className}
      >
        {children}
      </button>
    </form>
  );
}
