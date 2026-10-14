## Summary

## Checklist

- [ ] `python3 scripts/check.py` passes (manifest, reference graph, escaping).
- [ ] `node scripts/test-core.js` and `node scripts/test-remote-request.js` pass.
- [ ] `sh package-extension.sh` produces a clean zip.
- [ ] Security boundaries preserved (HTTPS-only remote, session-only keys,
      bounded imports, escaped output).
- [ ] `manifest.json` version bumped when behavior changes.

## Verification

Paste the commands you ran and their result.
