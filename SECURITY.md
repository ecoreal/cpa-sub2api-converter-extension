# Security Policy

## Scope

In scope:

- Remote URL validation bypasses (non-HTTPS targets, credential-bearing or
  fragmented URLs, lookalike localhost forms).
- HTML output escaping gaps (converted account data is untrusted input).
- Path traversal or ZIP Slip via converted filenames.
- Credential handling regressions (keys reaching persistent storage or
  logs).
- Size/timeout bound bypasses for imports, remote responses, or ZIP export.

Out of scope: the CPA/sub2api/CLIProxyAPI services themselves — report those
to their respective projects.

## Reporting

Create a private advisory on GitHub ("Report a vulnerability" under the
Security tab) for the repository owner, including a minimal reproducer
(input snippet + observed behavior). Do not open a public issue for an
undisclosed vulnerability.
