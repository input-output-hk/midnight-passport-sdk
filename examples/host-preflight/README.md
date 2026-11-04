# Host configuration inspection (local candidate)

`inspect.ts` is a strict TypeScript composition example for the candidate
`contract/capabilities` and `account/preflight` entries. Published RC6 lacks these
new entries. Use candidate tarballs from this branch; do not relabel RC6 evidence.

Pass the host's trusted `Partial<PassportPorts>` and one of the four covered existing
sealed-owner operations. The function invokes no ports or loaders; the caller can
show missing member paths before any key ceremony. A report with no issues still
requires runtime validation. It does not execute an account operation or establish
full Lace, browser/provider, proving, sponsorship or wallet compatibility.

Both supported authoriser arms are treated explicitly; an unknown/k256 arm never
falls back to P-256. This adds no package, host-specific dependency or outgoing ACC
bundle requirement. See `docs/site/capabilities.md` for the profile boundaries and
separate authority, artifact and evidence checks.
