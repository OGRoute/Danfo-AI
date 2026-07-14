<!-- Thanks for contributing to DanfoAI! -->

## What does this change?

<!-- A short description. What problem does it solve? -->

Closes #

## How to verify

<!-- Steps a reviewer can follow to see it works. -->

```bash
# e.g.
npx tsc --noEmit
npm run build
cd stellar/route-corrections && cargo test
```

## Checklist

- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` passes
- [ ] `cargo test` passes (if I touched the Soroban contract)
- [ ] I added/updated tests for behaviour changes
- [ ] UI changes work in **both light and dark mode** (used `var(--…)` theme tokens, no hard-coded colours)
- [ ] UI changes are keyboard-accessible and labelled
- [ ] **No secrets, keys, or `.env.local` values are included in this PR**

## Screenshots / output

<!-- For UI changes, include before/after. For contract or API changes, paste the output. -->
