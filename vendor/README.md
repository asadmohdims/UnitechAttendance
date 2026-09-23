# Vendored third-party files

Checked into the repo on purpose, instead of loaded from a CDN. Two reasons:

- **Offline boot.** Same-origin files are pre-cached by `sw.js`, so the kiosk can start with no
  network. A CDN `<script>` in `<head>` blocks the page until it loads, and if it fails the
  whole app fails with it.
- **Pinned and verified.** A version range like `@2` on a CDN changes whenever the publisher
  releases, with no review. These files only change when someone replaces them here.

| File | Package | Source | License | sha256 |
|---|---|---|---|---|
| `supabase-js-2.117.0.js` | `@supabase/supabase-js@2.117.0`, `dist/umd/supabase.js` | npm registry tarball | MIT | `7b9e9c64109e15c338fa58c2bc77c32fb1c459bd587e22fc6b72cca80a388645` |
| `xlsx-0.18.5.full.min.js` | `xlsx@0.18.5`, `dist/xlsx.full.min.js` | npm registry tarball (same bytes as cdnjs/jsDelivr) | Apache-2.0 | `c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99` |

Each tarball was checked against the npm registry's published `dist.integrity` (sha512) before
the file was extracted.

`xlsx` 0.18.5 has known advisories, but they're in spreadsheet *parsing*. This app only
*writes* files (the Report's Excel export), so they don't apply. It's loaded on demand when
Export is tapped, never at boot, and isn't pre-cached. After first use the service worker
caches it.

The Bebas Neue font files in `assets/fonts/` come from Google Fonts (SIL Open Font License),
latin and latin-ext subsets, the same files Google Fonts serves.

## Upgrading

Download the new version's tarball from `https://registry.npmjs.org/<package>`, verify it
against `dist.integrity`, and copy the file in under a new versioned name. Then update the
reference (`index.html` for supabase-js, `js/ui/report.js` for xlsx) and `APP_SHELL` in
`sw.js`. `node --test js/` fails if `index.html` points at a file `sw.js` doesn't pre-cache.
