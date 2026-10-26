# ADR 0011: fast CI and coherent milestone slices

Date: 2026/10/20. Status: accepted for local implementation by owner instruction.
Refs #231, #235, #236.

## Context

The owner requested local milestone execution on the existing branch, coherent
5k–10k-line PRs, and meaningful CI targeting 30–45 seconds. The historical
400/600-line split rules conflict with that preference. Full proof/key generation
cannot fit the requested feedback time, and all prover keys exceed the current
10 GB repository cache setting.

## Decision

Use reviewable coherent slices, with smaller signed commits and a review map.
Line counts are advisory; never pad a diff or split solely at the old budget.
Keep all fast tests and types on PRs, cache dependency downloads and image layers,
and measure actual warm hosted timing. Preserve the full local pre-commit gate.
Add a separate trusted key-qualification workflow with a bounded public profile,
exact input/toolchain cache identity and mandatory per-file hash verification.
Leave proof/browser/chain qualification and release publication in separate lanes.

Store milestone research, private consumer notes, redacted evidence and handovers
in the owner's Obsidian initiative. Keep public engineering docs in this repository.

## Consequences and revisit

Large PRs require explicit acceptance sections and a review map. A green fast gate
does not establish proof-backed safety, provider compatibility or release acceptance.
Keys remain reproducible public artifacts and cache is disposable. Do not increase
paid storage or change branch protection without a separate owner decision.
Measure warm/cold runs after an authorised push; revisit cache size, selection and
Nix/build-output caching only when timing and occupancy justify them.
