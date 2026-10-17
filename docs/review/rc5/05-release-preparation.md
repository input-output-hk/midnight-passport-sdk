# Prepare unpublished preview RC5 for release review

Local PR draft; no GitHub PR created.

- Head: `release/preview-rc5-local` (resolve its final signed tip after local checks).
- Initial review base: `review/rc5-lace-runtime` at `6c6e3c7af6e6b08de0f8cae44f3c117d2c982e35`.
- Final merge target: `passport-acc-prototype`, after the implementation slices merge.

## Summary

Prepare RC5 candidate notes and Pages navigation without changing RC4 installation examples.
Provide local review branches and PR bodies, package hashes and validation receipts. Build
Linux container candidates and render the Pages site; distinguish local artifact checks from
registry publication, visibility and deployed-site verification.

## Review focus

- RC5 is explicitly unpublished. No signed trigger tags are created during preparation.
- The candidate keeps exact-value shielded withdrawals and all documented Lace scope limits.
- Existing signed implementation commits are preserved across the review stack.
- Receipt fields distinguish passing checks, incomplete checks, local image IDs and registry
  manifest digests. No local ID is presented as a verified published image digest.
- Proposed issue closures remain pending review/merge; GitHub issue state is unchanged.

## Local review

```sh
git diff review/rc5-lace-runtime...release/preview-rc5-local
git log --show-signature review/rc5-lace-runtime..release/preview-rc5-local
```

Run source CI on the final prototype head before creating any release tags. After approved
publication, verify the private publisher attestation against registry bytes, package access,
all three pulled image digests, mounted-tree startup/network behavior and deployed Pages links.
