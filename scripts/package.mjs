import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { zipSync } from "fflate";
import { createHash } from "node:crypto";
const files = {};
async function walk(root, rel = "") {
  for (const ent of await readdir(join(root, rel), { withFileTypes: true })) {
    const name = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) await walk(root, name);
    else files[name] = new Uint8Array(await readFile(join(root, name)));
  }
}
await walk("dist");
const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
const name = `zephyer-${manifest.version}.zip`,
  data = zipSync(files);
await writeFile(`release/${name}`, data);
await writeFile(
  "release/SHA256SUMS.txt",
  `${createHash("sha256").update(data).digest("hex")}  ${name}\n`,
);
console.log(`Packaged release/${name}`);
