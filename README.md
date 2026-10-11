# Synthetic UI recording comments

A small original UI demonstrates Cypress recordings in one maintained
pull-request comment. All UI, data and tests are defined in this repository.

The pull-request workflow tests the merge commit with a read-only token and
disabled checkout credentials. Changed files select filter, toggle and notice
scenarios. Other files are explicitly marked unmapped. Each recorded scenario
has a result, a video path, size and SHA-256 in a manifest bound to the repository,
run, attempt and current PR head/base/merge commits.

The publisher runs on `workflow_run` and an owner attachment `issue_comment`
from the default branch with a separate
repository-scoped token. It validates bounded API responses, the artifact digest,
ZIP paths, manifest, recordings and current PR before writing. It never executes
PR code or artifact content. Its only write is creating or updating one marker
comment owned by `github-actions[bot]`. Human comments are preserved. Old or stale
evidence cannot replace a newer result.

The publisher grants `actions: read`, `contents: read` and `pull-requests: write`.
The PR-comment POST was rejected with `issues: write` plus `pull-requests: read`
in the initial hosted check; this uses the documented PR-write alternative.

Passing and failing browser runs can both publish evidence. A failed assertion
continues to fail the recording workflow after evidence upload. Unmapped-only
changes report that no scenario ran. Missing evidence and malformed manifests
stop publication.

Recordings are real browser capture of synthetic UI. Scenario results describe
only the tested interactions. Artifact downloads require GitHub login and expire
after seven days; links are downloads, with no automatic inline upload claim.

## Native inline videos

Native players require a manual upload for each recording run. GitHub CLI
`gh --attach` rejects GitHub App installation tokens, including `GITHUB_TOKEN`;
adding workflow write scopes does not enable that upload. The repository owner
uses their existing CLI user login to upload the exact verified synthetic MP4s.
The bot downloads the public attachments without authorization and checks their
sizes and SHA-256 hashes against the validated evidence, then automatically
creates or updates its existing marker comment. This is a manual user upload
followed by automatic verified bot maintenance. It demonstrates this original
toy UI only.

The owner posts a PR comment whose first two lines are:

```text
<!-- synthetic-inline-attachments -->
<!-- {"schema_version":1,"run_id":RUN_ID,"run_attempt":ATTEMPT,"tested_sha":"TESTED_MERGE_SHA","scenarios":[{"id":"filter-items","sha256":"VIDEO_SHA256","size_bytes":VIDEO_SIZE}]} -->
```

Replace the placeholders using the current artifact manifest. Include every
recorded scenario in manifest order. Use that two-line body with `gh pr comment
PR_NUMBER --body-file RECEIPT_FILE --attach EXACT_VERIFIED_MP4`, repeating
`--attach` in the same order for multiple recordings. The CLI appends standalone
native URLs. Those URLs and blank lines must be the only content after the
receipt. At most three videos of at most 10 MiB each are accepted; the server's
plan-specific upload limits also apply.

Only comments from `livstowe`, numeric user ID `27290147`, with user type `User`
are eligible. A new eligible comment triggers the trusted publisher; edits do
not trigger it. The receipt must identify the current run, attempt and tested
merge SHA, and each scenario's ID, size and hash. One handoff is allowed per
source run. Malformed owner receipts, ambiguous handoffs, stale metadata,
unknown URL hosts or differing downloaded bytes stop publication without
writing. Native redirects are limited to GitHub attachment paths,
`private-user-images.githubusercontent.com`, `user-images.githubusercontent.com`
and the observed exact host `github-production-user-asset-6210df.s3.amazonaws.com`.
Signed storage URLs are never placed in comments
or logs. The public native URL occupies its own paragraph under each scenario,
so GitHub renders it as a player.

Without a matching handoff, the publisher keeps its artifact-download mode.
Unmapped-only runs still skip comment writes. Both event types share a small
concurrency group, and only the marker-owned bot comment is changed; the human
receipt is preserved. Before each write the publisher checks the source run
and current PR again. No new PAT, repository setting or workflow permission is
required for this handoff.

## Local checks

Use Node 22 and `npm ci --no-audit --no-fund`. `npm test` runs publisher and mapping
checks. Hosted Cypress runs use the locked dependency set on `ubuntu-latest`.

## Hosted proof

See [the verified hosted proof](proof/README.md), [the exact bot comment](proof/comment-example.md)
and [the real inline players](https://github.com/livstowe/test-ui-comments/pull/1#issuecomment-6111060479).

## References

- [GitHub workflow_run](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
- [GITHUB_TOKEN repository scope](https://docs.github.com/en/actions/concepts/security/github_token)
- [Artifact REST API](https://docs.github.com/en/rest/actions/artifacts)
- [PR conversation comments](https://docs.github.com/en/rest/issues/comments)
- [CLI native attachment behavior](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli)
- [CLI installation-token guard](https://github.com/cli/cli/blob/v2.102.0/internal/attachments/client.go)
