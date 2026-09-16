# Releasing

Releases use explicit versions, curated changelog entries, and immutable
`v<version>` tags. Pushing a matching tag runs
`.github/workflows/publish.yml`, which stages the release through npm trusted
publishing (`npm stage publish`), then creates a GitHub Release from the
matching `CHANGELOG.md` section.

Staging defers publication to a human: the tag push never makes the version
installable by itself. After the workflow succeeds, approve the staged version
on npmjs.com (or with `npm stage approve <stage-id>`, which requires 2FA) to
publish it. Note the GitHub Release is created when the stage succeeds, so it
can exist briefly before npm approval.

The workflow uses GitHub's OIDC identity and does not require an npm token. It
uses the npm version bundled with Node 24 and fails before staging if that
version is older than the staged-publishing minimum (npm 11.15.0).

## Prepare a release

1. Add a nonempty `## [<version>] - YYYY-MM-DD` section to `CHANGELOG.md`.
2. Update `version` in `package.json` and `package-lock.json` without creating a
   tag:

   ```bash
   npm version <version> --no-git-tag-version
   ```

3. Run the release checks locally:

   ```bash
   npm ci
   npm run check
   npm run pack:check
   node scripts/extract-release-notes.ts <version>
   ```

4. Merge the version and changelog change after CI passes.
5. Verify the intended commit, then create and push an annotated `v<version>`
   tag at that exact commit.

The tag push starts the publish workflow. It rejects a tag that differs from
`package.json`, a tag that does not point at the checked-out commit, and a
missing or empty changelog section before staging. After staging succeeds, it
creates the corresponding GitHub Release using only that version's changelog
section; the version goes live on npm only when a maintainer approves the
staged release.

Do not move or reuse a pushed release tag. If a release fails after its tag is
pushed, fix the problem and release a new version.

## Initial release

The first publication registers the package name before npm trusted publishing
can be configured, because trusted publishing must reference an existing
package. Perform the bootstrap in this order:

1. Merge the reviewed packaging and release setup.
2. Publish the first version manually from the exact merged commit, using a
   short-lived credential held only in memory or a secrets manager. Do not
   write the credential to disk or check it into the repository.

   ```bash
   npm publish --access public --provenance=false
   ```

   The first local publication cannot carry GitHub Actions provenance. This
   override disables `publishConfig.provenance` only for the bootstrap; later
   OIDC releases publish with provenance.

3. With the package now registered, configure npm trusted publishing for this
   exact repository and the `publish.yml` workflow filename. Allow only
   `npm stage publish` on the trust relationship; keep `npm publish`
   disabled so every release requires human approval.
4. Revoke the short-lived bootstrap credential.

After the bootstrap, every future release publishes through OIDC by pushing an
approved immutable `v<version>` tag as described above. Do not push the initial
version's tag in a way that reruns publication for a version that was already
published manually.
