// Staged files only, from .husky/pre-commit (#135). Typecheck, tests and the
// build stay in npm run check and in CI: they need the whole project.
// Prettier writes first, then ESLint reads the formatted file. The globs do
// not overlap, so the two never edit the same file at once.
const lintStagedConfig = {
  "*.{js,mjs,ts,tsx}": ["prettier --write", "eslint --no-warn-ignored"],
  "!(*.js|*.mjs|*.ts|*.tsx)": "prettier --write --ignore-unknown",
};

export default lintStagedConfig;
