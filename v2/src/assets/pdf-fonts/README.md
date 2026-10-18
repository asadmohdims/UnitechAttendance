# Fonts embedded in the PDF reports

Static, trimmed TrueType files, because the PDF library cannot use the app's variable woff2 files, and because the IBM Plex
Mono TTFs as published crash the library's font reader ("Offset is outside the bounds of the DataView"). Trimming them
with fontTools (which rewrites the tables cleanly) fixed that and cut each file from 40 to 138 KB down to about 17 to 19 KB.

| File | Family and weight | Original source |
|---|---|---|
| Figtree_400Regular.ttf, Figtree_600SemiBold.ttf | Figtree 400, 600 | npm `@expo-google-fonts/figtree` 0.4.1 |
| IBMPlexMono_400Regular.ttf, IBMPlexMono_600SemiBold.ttf | IBM Plex Mono 400, 600 | npm `@expo-google-fonts/ibm-plex-mono` 0.4.1 |

Kept: Basic Latin, Latin-1, – — ‘ ’ “ ” • ‹ › − ₹ × ÷. The reports need only these. Both families have ₹ (checked). Neither
Figtree nor Plex Mono has ✎ or ✓ in Figtree, so the reports do not print them.

To rebuild one (fonttools 4.60):

```
pyftsubset Original.ttf --unicodes="U+0020-007E,U+00A0-00FF,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2022,U+2039,U+203A,U+2212,U+20B9,U+00D7,U+00F7" \
  --layout-features='kern,liga' --no-hinting --glyph-names --output-file=Name.ttf
```

Both families are licensed under the SIL Open Font License 1.1 (Figtree: Erik Kennedy; IBM Plex: IBM Corp.), which allows
embedding in documents. To add a character (a name in another script, say), add its range above and rebuild.
