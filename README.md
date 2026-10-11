# Synthetic UI recording comments

A small original UI demonstrates Cypress recordings linked from one maintained
pull-request comment. All UI, data and tests are defined in this repository.

The pull-request workflow tests the merge commit with a read-only token and
disabled checkout credentials. Changed files select filter, toggle and notice
scenarios. Other files are explicitly marked unmapped. Each recorded scenario
has a result, a video path, size and SHA-256 in a manifest bound to the repository,
run, attempt and current PR head/base/merge commits.

The publisher runs on `workflow_run` from the default branch with a separate
repository-scoped token. It validates bounded API responses, the artifact digest,
ZIP paths, manifest, recordings and current PR before writing. It never executes
PR code or artifact content. Its only write is creating or updating one marker
comment owned by `github-actions[bot]`. Human comments are preserved. Old or stale
evidence cannot replace a newer result.

Passing and failing browser runs can both publish evidence. A failed assertion
continues to fail the recording workflow after evidence upload. Unmapped-only
changes report that no scenario ran. Missing evidence and malformed manifests
stop publication.

Recordings are real browser capture of synthetic UI. Scenario results describe
only the tested interactions. Artifact downloads require GitHub login and expire
after seven days; links are downloads, with no automatic inline upload claim.

## Local checks

Use Node 22 and `npm ci --no-audit --no-fund`. `npm test` runs publisher and mapping
checks. Hosted Cypress runs use the locked dependency set on `ubuntu-latest`.

## Hosted proof

Public run, PR, comment and persistent synthetic-video links will be recorded
here after the hosted cases complete.

## References

- [GitHub workflow_run](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
- [GITHUB_TOKEN repository scope](https://docs.github.com/en/actions/concepts/security/github_token)
- [Artifact REST API](https://docs.github.com/en/rest/actions/artifacts)
- [PR conversation comments](https://docs.github.com/en/rest/issues/comments)
