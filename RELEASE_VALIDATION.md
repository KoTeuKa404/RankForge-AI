# RankForge 1.0 RC validation

This branch exists only to run the full pull-request CI against the current `main` release-candidate code.

The validation job must pass:

- locked dependency installation
- TypeScript and Vite production build
- Vitest suite
- release contract
- production dependency audit

After CI is green, this document can be merged or the branch can be deleted.
