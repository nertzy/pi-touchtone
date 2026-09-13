import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const expectedTag = `v${packageJson.version}`;
const refType = process.env.GITHUB_REF_TYPE;
const refName = process.env.GITHUB_REF_NAME;

if (refType !== "tag" || refName !== expectedTag) {
  console.error(`Publish workflow must run from tag ${expectedTag}.`);
  process.exit(1);
}

const tagsAtHead = execFileSync("git", ["tag", "--points-at", "HEAD"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

if (!tagsAtHead.includes(expectedTag)) {
  console.error(`Tag ${expectedTag} does not point at the checked-out commit.`);
  process.exit(1);
}

console.log(`Release ref ${expectedTag} matches package version.`);
