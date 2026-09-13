# Contributing to Touchtone

Thanks for taking an interest in Touchtone! Bug reports, documentation fixes,
and pull requests are all welcome. You don't need to have a solution before
opening an issue.

If you find a bug, please include a small example of what you tried, what
happened, and what you expected instead. Your Pi and Node.js versions help too.
For messaging problems, describe what the sending and receiving sessions were
doing. Please leave out private messages, credentials, and identifying details.

If you have a substantial feature in mind, consider opening an issue to discuss
it first. We may have thought about it already, and can sometimes save you a
detour. Touchtone is deliberately small, so finding a simple way to solve a
problem is part of the fun.

When in doubt, go ahead and open a pull request. If something needs tweaking or
rethinking, we will do our best to say so clearly. Don't be discouraged if we
ask you to change your code—we appreciate the work, and we also have opinions
about style and object design.

## Getting started

Install the development dependencies and run the checks:

```sh
npm ci
npm run check
npm run pack:check
```

`npm run check` runs linting, the tests, and TypeScript checking. You can also
run them separately with `npm run lint`, `npm test`, and `npm run typecheck`.
Linting uses Biome, markdownlint-cli2, and
[actionlint](https://github.com/rhysd/actionlint) 1.7.12. Biome and
markdownlint-cli2 install with the dev dependencies; install `actionlint`
separately (on macOS, `brew install actionlint`). Run `npm run lint:fix` to
apply the Biome and Markdown autofixes. The
[package manifest](./package.json) lists the development dependencies, and the
[CI workflow](./.github/workflows/ci.yml) shows the Node.js version used for CI.

For a behavior change, start with a test that demonstrates it. The tests in
[`test/touchtone.test.ts`](./test/touchtone.test.ts) use temporary
mailboxes so they don't interfere with your running sessions. Keep that
isolation when adding tests.

You can try your checkout in Pi with:

```sh
pi install /absolute/path/to/your/pi-touchtone
```

Use your checkout's actual path. Remove any other Touchtone installation
from that Pi configuration first, so it doesn't register the tool twice. Run
`/reload` in Pi after making changes.

## Preparing a pull request

Tell us what problem your change solves and why you chose this approach. Small,
focused changes are easier to review, and documentation improvements are just
as welcome as code.

Please leave version bumps and publishing to the maintainer. There is no need
to prepare a release as part of your pull request.

Last, but not least, have fun! Touchtone is a labor of love. 📞
