# Microsoft Store build

The Windows app uses the existing Electron host and the shared Expo web renderer/core. The renderer is bundled locally; it is not a remote web wrapper. Windows x64 is the initial build target. UI languages are Korean, English, Japanese and Simplified Chinese.

The Korean app name is **modo - 메모와 할 일** and its introduction is **떠오른 생각과 해야 할 일을 한곳에.** The in-app logo reads **modo**. The requested English Store listing title is **modo - Simple Memo & ToDo**, with an ASCII hyphen and no trailing period. The promotional tagline is **Simple, modern Memo & ToDo.** These are listing drafts until the names are reserved and accepted in Partner Center. The executable and local data paths retain the short name `modo`; the Store package display name uses the Korean app name. Changing a listing title must not change the package identity or existing local data paths.

## Reproduce

Use Node 24 on Windows:

```powershell
cd app
npm ci
npm run typecheck
npm run lint
cd ../desktop
npm ci
node node_modules/electron/install.js
npm run test:unit
npm run dist:win
```

`dist:win` creates the unsigned portable ZIP in `desktop/dist/`. It is a runnable build, not a Microsoft Store submission. Production core compilation locks account/content API requests to `https://modo.kodeploy.com`. No signing certificate is generated or installed and no machine security setting is weakened.

## Partner Center identity and Store package

Sign in to Partner Center, complete any required identity verification, reserve the app name, then copy the exact Product management → Product identity values:

```powershell
$env:MODO_STORE_IDENTITY = '<Package/Identity/Name from Partner Center>'
$env:MODO_STORE_PUBLISHER = '<Package/Identity/Publisher from Partner Center>'
$env:MODO_STORE_PUBLISHER_NAME = '<Package/Properties/PublisherDisplayName from Partner Center>'
npm run dist:store
```

This creates a single x64 `.appx` with the current desktop package version (1.0.2.0), Windows.Desktop minimum 10.0.19041.0, four actual UI languages, and only the required `runFullTrust` capability. The official Windows SDK MakePri indexes the scale/target-size icon assets and MakeAppx validates the package. The build refuses missing identity values. Microsoft signs the package after certification; no external paid EXE certificate is required.

The initial Store package does not register a login startup task and hides the portable app's registry-based auto-start option. Pinning, opacity and the tray remain available. The custom manifest uses the reserved Store title for package metadata and `modo` for the installed launcher. Its literal ampersand is XML-escaped.

After an unpacked Electron build, the SDK packaging stage can also be run directly:

```powershell
pwsh -NoProfile -File scripts/pack-store-sdk.ps1 -Prepare
```

The script verifies the actual Partner Center identity and retains MakeAppx validation. It does not create a test certificate, disable validation or change Windows security settings. Windows icon generation preserves the approved artwork's RGB pixels, rounds only the outer plate with transparent corners, and provides light/dark unplated target sizes to prevent a square system backplate. Run `node scripts/generate-icons.cjs` to regenerate Windows assets without touching mobile icons.

Before submission, run the Windows App Certification Kit on the identity-matched package, verify installed package startup/uninstall, and test local editing, offline restart, login, sync and authenticated deletion using isolated data. A successful portable build or unit test does not establish that a Store package passed certification. Store-managed installation, startup integration and updates require separate installed-package testing.

## Service and policy

- Free initially; no ads or current subscription billing. General productivity app targeting people aged 16+; content rating must be obtained separately from actual functions.
- Initial requested countries: KR, JP, TW, HK, GB, CA, AU, NZ, SG.
- Use Windows screenshots and descriptions; do not represent Android widgets as Windows features.
- Privacy: https://midi-broccoli-56c.notion.site/3fd5028467088169bca6fc67ea233912
- Deletion: https://midi-broccoli-56c.notion.site/3fd50284670881b3bda5f7963475aa67
- Support: yuntyu01@gmail.com
- Provider retention/hosting-region limitations remain as documented in the privacy policy.

The local SQLite DB enables secure deletion. Accepted account erasure clears shared core records, removes modo-managed migration backups and checkpoints the WAL; a persisted cleanup flag retries interrupted backup/checkpoint work at next launch. User-created JSON exports and other people's copies are managed separately.

## Current Store identity

The free individual developer account was created and verified on 2026-10-20 after owner identity verification and explicit developer-agreement approval. Product `9P8SSJ8GBB1X` reserves `modo - Simple Memo & ToDo`. Its package identity is `yuntyu01.modo-SimpleMemoToDo`, publisher `CN=8C166C00-D40B-41A4-A2F6-68E632355E49`, and publisher display name `yuntyu01`. Product creation and package generation are separate from certification and publication. Do not send passwords/passkeys/identity documents in chat.
