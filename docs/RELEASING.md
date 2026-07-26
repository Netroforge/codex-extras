# Releasing

Releases are published from GitHub Actions when a tag matching `v*` is pushed.

## One-time Marketplace setup

1. Create or select the Visual Studio Marketplace publisher with ID `netroforge`.
2. Create an Azure DevOps personal access token with **All accessible organizations** and **Marketplace → Manage** scope.
3. Add it to the GitHub repository as an Actions secret named `VSCE_PAT`.
4. Optionally protect a GitHub environment before enabling unattended releases.

Never commit or paste the token into an issue, pull request, workflow file, or build log.

> Azure DevOps global PATs are scheduled for retirement on 2026-12-01. Migrate this workflow to Microsoft Entra ID workload identity federation when GitHub Actions is supported by the official VS Code Marketplace publishing flow, or move the publishing job to an Azure Pipeline using `vsce publish --azure-credential`.

## Publish a version

1. Update the version in `package.json`.
2. Update `CHANGELOG.md`.
3. Run:

   ```sh
   npm ci
   npm test
   npm run package
   ```

4. Commit and merge the version change.
5. Tag the exact version and push it:

   ```sh
   git tag v1.0.1
   git push origin v1.0.1
   ```

The release workflow verifies that the tag matches `package.json`, packages the VSIX, publishes it to the Visual Studio Marketplace, and creates a GitHub release containing the same VSIX.
