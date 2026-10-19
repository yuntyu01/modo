# App icon

`user-symbol-20261019.jpg` is the latest exact artwork supplied by the owner.
`user-logo-20261019.jpg` preserves the earlier artwork used by Android version 21.
`app-icon-source.png` is its lossless decoded PNG, without redrawing or recoloring.
Run `node app/scripts/import-symbol.cjs` to import the latest JPEG and trace its blue
silhouette into `symbol-path.json` and `symbol.svg`. This also updates Android widget
and quick-add vectors and the iOS widget shape. The outline simplification tolerance
is 0.65 source pixels. In-app symbols retain the existing theme-color preference;
the launcher and store icons retain the image's blue on black.
Run `node app/scripts/generate-icons.cjs` from the repository root to encode mobile,
Android adaptive/themed, splash, web, Windows and Store assets. `store-icon-512.png` is the
512×512 Google Play icon from this same source. Adaptive icons include padding for
Android's mask and use the source background color. The themed icon is a coverage
mask, so Android controls its colors when themed icons are enabled.

Installed app name: `modo`. Store titles remain separate metadata.
