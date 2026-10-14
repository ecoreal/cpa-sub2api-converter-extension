# Browser Extension

[中文](README.md) · English

This is the browser extension build of the CPA batch converter, loadable in
Chrome and Edge via developer mode.

## Layout

- `manifest.json`: Manifest V3 configuration
- `popup.html`: extension popup entry
- `dashboard.html`: full workbench page
- `converter-core.js`: local conversion core
- `dashboard.js`: workbench interaction logic
- `icons/`: extension icon assets
- `store-listing.md`: Chrome Web Store listing draft
- `privacy-policy.md`: privacy policy draft
- `package-extension.sh`: packaging script

## Loading

1. Open the Chrome or Edge extension management page.
2. Enable "Developer mode".
3. Choose "Load unpacked".
4. Select this directory (the one containing `manifest.json`).

Icons are committed under `icons/`; to replace them, overwrite the PNGs with
the same names.

## Usage

1. Click the extension icon.
2. Open the workbench from the popup.
3. Import multiple CPA JSON files, or import a whole directory.
4. Optionally fill in a `type` filter.
5. Download the generated `sub2api-account-{timestamp}.json`, or configure a
   remote service and upload directly.

## Remote upload

The workbench supports two remote targets:

- CLIProxyAPI: uploads raw CPA JSON to `POST /v0/management/auth-files`,
  authenticated with `Authorization: Bearer <Management Key>`.
- sub2api: imports converted `sub2api-data` to
  `POST /api/v1/admin/accounts/data`, authenticated with
  `x-api-key: <Admin API Key>`. If your deployment changed
  `VITE_API_BASE_URL`, adjust the API prefix on the page.

Service addresses and ordinary preferences are stored in
`chrome.storage.local`; the Management Key and Admin API Key live only in the
current extension session and are never written to persistent storage.
Network requests happen only when you click the corresponding upload button
or test connection.

Remote addresses must use HTTPS; only `localhost`, `127.0.0.1`, and `::1` may
use HTTP. Local development addresses must not carry credentials, query
parameters, or fragments.

Imports process at most 500 JSON files, 8 MiB per file and 32 MiB total;
remote responses and ZIP exports are also bounded and requests carry
timeouts.

Each service has a "test connection" button:

- CLIProxyAPI: `GET /v0/management/auth-files`, verifying only the Management
  Key and endpoint availability.
- sub2api: `GET /api/v1/admin/accounts?page=1&page_size=1`, verifying only
  the Admin API Key and endpoint availability.

## Design notes

- No backend dependency.
- No network requests by default; the remote upload feature calls the
  CLIProxyAPI/sub2api services you configure.
- `chrome.storage.local` stores filter conditions and the filename prefix;
  remote keys use session storage only.
- Data is processed entirely locally in the extension page.

## Local checks

The project ships dependency-free static checks and conversion-core
regression tests:

```bash
python3 scripts/check.py
python3 scripts/test_check.py
node scripts/test-core.js
node scripts/test-remote-request.js
```

`check.py` validates the extension manifest, required files, the
manifest/HTML/JS reference graph (no dangling references), remote URL
validation, HTML output escaping, and obvious hard-coded API keys.
`test-core.js` uses synthetic data to verify converted filenames cannot
produce path traversal or ZIP Slip member paths.

## Packaging

Run in this directory:

```bash
sh package-extension.sh
```

The script derives the packaged file set from `manifest.json` and the
popup/workbench HTML reference graph (including JS module dependencies), and
fails on any missing reference; output goes to
`dist/cpa-to-sub2api-extension-<version>.zip`, ready for the Chrome Web
Store.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md); report security issues privately per
[SECURITY.md](SECURITY.md).

## Before publishing to the store

- Publish `privacy-policy.md` at a publicly reachable URL.
- Prepare 1–4 store screenshots.
- Adjust `store-listing.md` for your publishing entity's details.
