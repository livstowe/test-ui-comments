# Verified synthetic recording proof

[Open the maintained bot comment](https://github.com/livstowe/test-ui-comments/pull/1#issuecomment-6111060479).

The actual GitHub comment contains three native video players. An isolated Chrome session
sought into the tested UI states, played each video, observed advancing playback time,
visible controls and decoded 1280×720 frames with no media errors. The current source
tested merge is `b74bff6d29b345f082585c6754c485c8eeeb9497`; all three reported scenarios passed.

The repository owner uploaded each audited clip with the existing CLI user login.
The receipt triggered the trusted publisher, which downloaded the public attachments
without a token, verified their exact size and SHA-256 against the source artifact,
and updated bot comment 6111060479. Replaying it caused no write. Each new recording
still needs that user upload step; the Actions token does not upload native attachments.

- [filter-items](https://github.com/user-attachments/assets/4b554dfb-341d-41e2-935a-19b5cd0fc15a) — 274266 bytes, SHA-256 `46a5fdfe358441aaa5d722d950b6a6e16015ba47bc827f0b6420a27c3288f3f9`
- [toggle-state](https://github.com/user-attachments/assets/4f7b425f-4bef-4ee6-9459-2439c3d504f9) — 129107 bytes, SHA-256 `a67252d0bdfc1c686944c806c080b3c202df7d3f965d825d160401738fb955c9`
- [dismiss-notice](https://github.com/user-attachments/assets/4e324245-bb86-4043-af0c-f873acaa33e7) — 140100 bytes, SHA-256 `eea667e561947454ef214c517b1d55374e88bccd3931132501ae30c3ef178e08`

| Hosted case | Recording run | Publisher attempt | Result |
| --- | --- | --- |
| bot create | [run](https://github.com/livstowe/test-ui-comments/actions/runs/38154830270) | [attempt 1](https://github.com/livstowe/test-ui-comments/actions/runs/38154894493/attempts/1) | created comment 6111060479 |
| three-scenario update and unmapped path | [run](https://github.com/livstowe/test-ui-comments/actions/runs/38154990566) | [attempt 1](https://github.com/livstowe/test-ui-comments/actions/runs/38155068455/attempts/1) | updated the same comment; docs/demo-notes.md unmapped |
| duplicate delivery | [run](https://github.com/livstowe/test-ui-comments/actions/runs/38154990566) | [attempt 2](https://github.com/livstowe/test-ui-comments/actions/runs/38155068455/attempts/2) | unchanged ID, body and timestamp |
| stale source replay | [run](https://github.com/livstowe/test-ui-comments/actions/runs/38154830270) | [attempt 2](https://github.com/livstowe/test-ui-comments/actions/runs/38154894493/attempts/2) | rejected current-head mismatch; unchanged comment |
| real failing assertion | [run](https://github.com/livstowe/test-ui-comments/actions/runs/38155247186) | [attempt 1](https://github.com/livstowe/test-ui-comments/actions/runs/38155326014/attempts/1) | producer failed; toggle marked FAILED; same-ID bot update |
| restore passing behavior | [run](https://github.com/livstowe/test-ui-comments/actions/runs/38155412034) | [attempt 1](https://github.com/livstowe/test-ui-comments/actions/runs/38155486114/attempts/1) | three passing scenarios; same-ID bot update |
| unmapped-only PR | [run](https://github.com/livstowe/test-ui-comments/actions/runs/38155470051) | [attempt 1](https://github.com/livstowe/test-ui-comments/actions/runs/38155483742/attempts/1) | manifest-only evidence; no browser run or bot comment |
| fresh inline source | [run](https://github.com/livstowe/test-ui-comments/actions/runs/38156411288) | [attempt 1](https://github.com/livstowe/test-ui-comments/actions/runs/38156490674/attempts/1) | current three-scenario browser evidence |
| native upload handoff | [run](https://github.com/livstowe/test-ui-comments/actions/runs/38156411288) | [attempt 1](https://github.com/livstowe/test-ui-comments/actions/runs/38156579668/attempts/1) | owner user upload; automatic same-ID bot update with three real players |
| native handoff replay | [run](https://github.com/livstowe/test-ui-comments/actions/runs/38156411288) | [attempt 2](https://github.com/livstowe/test-ui-comments/actions/runs/38156579668/attempts/2) | unchanged ID, body and timestamp |

99 local checks passed (84 publisher, 15 producer). Missing artifacts, malformed
manifests, duplicate bot markers, false owner identities, conflicting receipts,
bad hashes and unsafe redirects were exercised through local mocked API adapters.
The hosted browser captures, artifact download verification, bot API writes,
native uploads, duplicate/stale replays and GitHub player playback were real.

These are original toy UI scenarios. Their mapping is explicit and unmapped changes
receive no coverage claim. Hashes verify received bytes; results remain producer claims.
Artifact bundles require GitHub login and expire after seven days.

See [the exact example comment](comment-example.md) and [machine-readable proof](hosted-proof.json).

[CLI attachment guide](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli)
and [installation-token guard](https://github.com/cli/cli/blob/v2.102.0/internal/attachments/client.go)
describe the supported user upload path. Native attachment access follows repository
[visibility](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files).
