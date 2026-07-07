# Release

## macOS Signing And Notarization

Codex Scheduler ships a Tauri desktop app plus two sidecar binaries:

- `codex-schedulerd`
- `codex-schedule`

Both sidecars are bundled through `apps/desktop/src-tauri/tauri.conf.json` under `bundle.externalBin`. Treat them as release artifacts: build them from the same commit, copy them into the expected `binaries/` location via `pnpm sidecars:prepare`, and ensure the final app bundle signs them with the rest of the `.app`.

### Prerequisites

1. Install an Apple Developer ID Application certificate in the login keychain.
2. Confirm the identity is visible:

```bash
security find-identity -v -p codesigning
```

3. Set the Tauri macOS signing identity in `apps/desktop/src-tauri/tauri.conf.json`:

```json
"macOS": {
  "signingIdentity": "Developer ID Application: Your Company (TEAMID)",
  "providerShortName": "TEAMID"
}
```

Leave `signingIdentity` as `null` for local unsigned builds.

### Notarization Environment

Set these environment variables in the release shell or CI secret store:

```bash
export APPLE_ID="release@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
```

Use an app-specific password for `APPLE_PASSWORD`, not the Apple ID account password.

### Build Flow

From the repository root:

```bash
pnpm install
pnpm sidecars:prepare
pnpm --filter desktop tauri build
```

The Tauri build signs the `.app` bundle when `bundle.macOS.signingIdentity` is set. The bundled sidecars must be present before `tauri build`; otherwise the final bundle can be unsigned or missing required executables.

After build, verify the app and sidecars:

```bash
codesign --verify --deep --strict --verbose=2 apps/desktop/src-tauri/target/release/bundle/macos/Codex\ Scheduler.app
spctl --assess --type execute --verbose apps/desktop/src-tauri/target/release/bundle/macos/Codex\ Scheduler.app
```

If notarization does not run automatically in the configured Tauri release flow, submit the built archive with `xcrun notarytool` using the same Apple ID, password, and team ID, then staple the result to the app or DMG before distribution.
