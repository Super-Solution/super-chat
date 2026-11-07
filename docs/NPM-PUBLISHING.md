# Manual npm releases

Configure each package's npm Trusted Publisher with GitHub organization
`Super-Solution`, repository `super-chat`, workflow filename `npm-publish.yml`,
an empty environment, and permission for direct `npm publish`:

- `@supersolutions/super-protocol`
- `@supersolutions/super-chat-core`
- `@supersolutions/super-chat-client`
- `@supersolutions/super-chat-server`
- `@supersolutions/super-chat-ui-core`
- `@supersolutions/super-chat-router`
- `@supersolutions/super-chat-react`
- `@supersolutions/super-chat-ui`
- `@supersolutions/super-chat-plugin`

An npm maintainer completes this setup with account 2FA. Existing versions do not
need to be republished. Configure near the next intended release: a new trust
configuration expires if unused for two days.

For a release, commit the same reviewed version in all nine package manifests,
then manually run **Publish npm packages** on `main` with that exact version.
Use `latest` for stable versions, or `next` for `X.Y.Z-next.N` versions. The workflow
does not bump versions. It first checks that every manifest has the requested
version, the expected name, and is not `private`. It then installs locked
dependencies, builds once, packs using pnpm to replace `workspace:*` references, and
publishes in dependency order (protocol, core, client, server, ui-core, router, react,
ui, plugin) using npm OIDC. It uses GitHub-hosted runners and needs no npm secret or
Actions artifact upload. There are no push/PR publication triggers or new tests.

Already published versions cannot be overwritten. A partial release requires
inspection before another dispatch; this workflow does not unpublish, move tags,
or silently skip existing versions. After publication, check all nine registry
versions and dist-tags. Keep existing tokens until any other consumers have been
accounted for and the first OIDC release has succeeded. No paid usage or secret
changes are authorized by this workflow setup.

See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).
