import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";

const script = resolve("scripts/check-release-ref.ts");
const repositories: string[] = [];

after(() => {
  for (const directory of repositories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function repository() {
  const directory = mkdtempSync(join(tmpdir(), "pi-touchtone-release-ref-"));
  repositories.push(directory);
  writeFileSync(join(directory, "package.json"), '{"version":"1.2.3"}\n');
  execFileSync("git", ["init", "--quiet"], { cwd: directory });
  execFileSync("git", ["add", "package.json"], { cwd: directory });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Release Test",
      "-c",
      "user.email=release@example.com",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ],
    { cwd: directory },
  );
  return directory;
}

function check(directory: string, type: string, name: string) {
  return spawnSync(process.execPath, [script], {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_REF_TYPE: type,
      GITHUB_REF_NAME: name,
    },
  });
}

test("rejects a branch ref", () => {
  const result = check(repository(), "branch", "main");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must run from tag v1\.2\.3/);
});

test("rejects a tag that does not match the package version", () => {
  const directory = repository();
  execFileSync("git", ["tag", "v9.9.9"], { cwd: directory });

  const result = check(directory, "tag", "v9.9.9");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must run from tag v1\.2\.3/);
});

test("rejects the matching version tag when it does not point at HEAD", () => {
  const directory = repository();
  execFileSync("git", ["tag", "v1.2.3"], { cwd: directory });
  writeFileSync(join(directory, "later.txt"), "later commit\n");
  execFileSync("git", ["add", "later.txt"], { cwd: directory });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Release Test",
      "-c",
      "user.email=release@example.com",
      "commit",
      "--quiet",
      "-m",
      "later fixture",
    ],
    { cwd: directory },
  );

  const result = check(directory, "tag", "v1.2.3");

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Tag v1\.2\.3 does not point at the checked-out commit\./,
  );
});

test("accepts the matching version tag at HEAD", () => {
  const directory = repository();
  execFileSync("git", ["tag", "v1.2.3"], { cwd: directory });

  const result = check(directory, "tag", "v1.2.3");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Release ref v1\.2\.3 matches package version/);
});
