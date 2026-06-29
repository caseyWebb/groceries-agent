# CLA signatures

CLA Assistant records Contributor License Agreement signatures here, at
`signatures/version1/cla.json` (created on the first signature).

This branch exists only to hold that ledger. It is intentionally kept off
`main`: the bot commits each signature with a direct push, but `main` is
ruleset-protected (changes must go through a PR with required checks), which
rejects the push. Keep this branch **unprotected**, and do not delete it — the
CLA workflow's `branch:` input points at it.
