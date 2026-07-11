# Publishing the Darkmown VS Code extension

The manifest is Marketplace-ready (`publisher: zvndev`, icon, license, repository, categories) and `darkmown-<version>.vsix` packages cleanly. Publishing itself needs the Marketplace publisher account and a Personal Access Token, so it is a manual owner step.

## One-time setup

1. **Create the publisher** (once): sign in at <https://marketplace.visualstudio.com/manage> with a Microsoft account and create a publisher with ID `zvndev` — it must match the `publisher` field in `package.json` exactly.
2. **Create a PAT**: at <https://dev.azure.com> → User settings → Personal Access Tokens → New Token:
   - Organization: **All accessible organizations**
   - Scopes: **Custom defined** → Marketplace → **Manage** (that single scope is sufficient)
   - Note the token; it is shown once.

## Publish

From this directory (`editors/vscode`):

```sh
npx --yes @vscode/vsce login zvndev     # paste the PAT when prompted (once per machine)
npx --yes @vscode/vsce publish          # packages and uploads the current version
```

Or without a stored login:

```sh
npx --yes @vscode/vsce publish -p <PAT>
```

## Per-release checklist

- Bump `version` in `editors/vscode/package.json` and add a matching entry to `editors/vscode/CHANGELOG.md`.
- `npm test` in this directory (grammar/tokenization tests) must pass.
- `npm run pack:extension` from the repo root must produce a `.vsix` with no vsce errors (the `.vsix` is git-ignored — don't commit it).
- After `vsce publish`, verify the listing at `https://marketplace.visualstudio.com/items?itemName=zvndev.darkmown`, then update the README's "Editor support" section to point at the Marketplace instead of the VSIX flow.

## Open VSX (optional, for VSCodium/Cursor and friends)

```sh
npx --yes ovsx publish darkmown-<version>.vsix -p <OPEN_VSX_TOKEN>
```

Requires an account + namespace `zvndev` on <https://open-vsx.org> and its own access token.
