# Contributing

Thanks for improving the CPA to sub2api converter extension.

## Development

No package install is needed; checks are dependency-free (Python 3 +
Node.js for the JS tests).

```bash
python3 scripts/check.py
python3 scripts/test_check.py
node scripts/test-core.js
node scripts/test-remote-request.js
sh package-extension.sh
```

## Pull requests

- Keep changes focused; one behavior change per PR.
- Add or update tests for behavior changes (conversion-core tests are
  plain Node scripts; run them directly).
- Any new file referenced from `manifest.json` or the popup/dashboard HTML
  is picked up automatically by the packager and the checker; a dangling
  reference fails both.
- Keep the security boundaries intact: HTTPS-only remote targets (loopback
  excepted), session-only keys, bounded imports, escaped HTML output.

## Scope

This is an offline-first conversion tool: no backend dependency and no
network requests unless the user configures a remote service and clicks
upload/test.
