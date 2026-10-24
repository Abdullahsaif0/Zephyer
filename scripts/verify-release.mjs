import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
const name = `zephyer-${manifest.version}.zip`,
  bytes = await readFile(`release/${name}`),
  files = unzipSync(bytes);
const expected = [];
async function walk(rel = "") {
  for (const entry of await readdir(join("dist", rel), {
    withFileTypes: true,
  })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(path);
    else {
      expected.push(path);
      assert.deepEqual(
        Buffer.from(files[path] || []),
        await readFile(join("dist", path)),
        path,
      );
    }
  }
}
await walk();
assert.deepEqual(Object.keys(files).sort(), expected.sort());
for (const html of [
  "panel.html",
  "options.html",
  "offscreen.html",
  "gallery.html",
  "troubleshoot.html",
]) {
  for (const match of Buffer.from(files[html])
    .toString()
    .matchAll(/(?:src|href)="\/?([^"#]+)"/g))
    assert(files[match[1]], `Missing asset ${match[1]}`);
}
const hash = createHash("sha256").update(bytes).digest("hex");
assert.equal(
  (await readFile("release/SHA256SUMS.txt", "utf8")).trim(),
  `${hash}  ${name}`,
);
const prior = JSON.parse(
  Buffer.from(
    unzipSync(await readFile("release/zephyer-1.3.1.zip"))["manifest.json"],
  ).toString(),
);
for (const key of [
  "permissions",
  "host_permissions",
  "content_security_policy",
])
  assert.deepEqual(manifest[key], prior[key], key);
console.log(
  JSON.stringify(
    {
      version: manifest.version,
      archive: name,
      bytes: bytes.length,
      files: expected.length,
      sha256: hash,
      permissions: "unchanged",
    },
    null,
    2,
  ),
);
