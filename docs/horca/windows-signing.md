# Windows signing

Horca beta releases contain a clearly labelled unsigned Windows installer. Stable releases omit Windows. The release workflow checks the unsigned state so it cannot accidentally ship with Stably's publisher identity.

Use SignPath Open Source Code Signing if Horca is accepted. It keeps the private key outside GitHub and can sign nested files through an artifact configuration. SignPath requires its GitHub App, a project, a signing policy, an artifact configuration, and an API token. See [SignPath GitHub integration](https://docs.signpath.io/trusted-build-systems/github) and [artifact configuration](https://docs.signpath.io/artifact-configuration/).

If SignPath is not available, use a CA certificate with a cloud HSM service. electron-builder supports `signtool`, HSM, PKCS#11, and Azure signing backends. See [electron-builder Windows signing](https://www.electron.build/docs/features/code-signing/code-signing-win/).

## Required implementation

1. Obtain a certificate for the Horca publisher. Do not use Stably's subject or certificate.
2. Put signing credentials in a protected GitHub environment named `windows-signing`. Do not expose them to pull requests from forks.
3. Build the unpacked app first.
4. Sign Horca-owned inner executables and native modules.
5. Package the NSIS installer.
6. Sign and timestamp the final installer with SHA-256.
7. Replace the release workflow's `NotSigned` assertion with `Valid` and an exact certificate subject check.
8. Verify on a clean Windows VM with `Get-AuthenticodeSignature` and a silent install.

For SignPath, upload the unsigned build as an `actions/upload-artifact@v4` artifact. Submit its artifact ID to SignPath, wait for completion, download the signed result, then publish only that result. Define the nested signing rules in SignPath so the application binaries are signed before the outer installer.
