# App icon

`user-logo-20261019.jpg` is the exact artwork supplied by the owner on 19 October 2026.
`app-icon-source.png` is its lossless decoded PNG, without redrawing or recoloring.
Run `node app/scripts/generate-icons.cjs` from the repository root to encode mobile,
Android adaptive/themed, web, Windows and Store assets. `store-icon-512.png` is the
512×512 Google Play icon from this same source. Adaptive icons include padding for
Android's mask and use the source background color. The themed icon is a coverage
mask, so Android controls its colors when themed icons are enabled.

Installed app name: `modo`. Store titles remain separate metadata.
