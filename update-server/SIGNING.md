# Release signing — GitHub Actions secrets

The `Release` workflow (`.github/workflows/release.yml`) signs both platforms in
CI. Add these repository secrets once. Run every command **on your own machine**
— the certificates go straight from your keychain to GitHub secrets and are
never printed.

Set a secret:

```bash
# value from stdin (never echoed):
some-command-that-prints-the-value | gh secret set NAME -R felixchaos/vsnovel
```

## macOS (Developer ID + notarization)

| Secret | What |
|---|---|
| `MACOS_CERTIFICATE` | base64 of your **Developer ID Application** cert exported as `.p12` |
| `MACOS_CERTIFICATE_PWD` | the password you set when exporting the `.p12` |
| `APPLE_ID` | your Apple ID email |
| `APPLE_APP_PASSWORD` | an **app-specific password** (appleid.apple.com → Sign-In & Security → App-Specific Passwords) |
| `APPLE_TEAM_ID` | your 10-char Team ID (developer.apple.com → Membership) |

Export the cert + key from **Keychain Access**: find "Developer ID Application:
…", select it *and* its private key, right-click → Export 2 items → `.p12`, set
a password. Then:

```bash
base64 -i DeveloperID.p12 | gh secret set MACOS_CERTIFICATE -R felixchaos/vsnovel
printf '%s' 'the-p12-password'    | gh secret set MACOS_CERTIFICATE_PWD -R felixchaos/vsnovel
printf '%s' 'you@apple.example'   | gh secret set APPLE_ID -R felixchaos/vsnovel
printf '%s' 'abcd-efgh-ijkl-mnop' | gh secret set APPLE_APP_PASSWORD -R felixchaos/vsnovel
printf '%s' 'ABCDE12345'          | gh secret set APPLE_TEAM_ID -R felixchaos/vsnovel
```

## Windows (Authenticode)

| Secret | What |
|---|---|
| `WINDOWS_CERTIFICATE` | base64 of your code-signing cert as `.pfx` |
| `WINDOWS_CERTIFICATE_PWD` | the `.pfx` password |

```bash
base64 -i codesign.pfx | gh secret set WINDOWS_CERTIFICATE -R felixchaos/vsnovel
printf '%s' 'the-pfx-password' | gh secret set WINDOWS_CERTIFICATE_PWD -R felixchaos/vsnovel
```

## Cutting a release

Once the secrets are in, push a tag (or run the workflow with one):

```bash
git tag v1.129.1-nvl.1 && git push origin v1.129.1-nvl.1
```

The pipeline builds + signs both platforms, then publishes a GitHub Release with
the macOS `.zip`, the Windows user-setup `.exe`, and `update-manifest.json` — the
update Worker serves that release to installed editors.
