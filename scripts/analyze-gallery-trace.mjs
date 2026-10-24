import { readFile, writeFile } from "node:fs/promises";
const directory = process.argv[2] || "test-results/gallery";
const path = `${directory}/source-trace.json`;
const { traceEvents: events } = JSON.parse(await readFile(path, "utf8"));
const own = events.filter(
  (e) =>
    e.ph === "X" &&
    /\/content\.js(?:$|\?)/.test(
      e.args?.data?.scriptName || e.args?.data?.url || "",
    ),
);
const pids = new Set(own.map((e) => e.pid));
const main = events.filter((e) => pids.has(e.pid) && e.ph === "X");
const largest = (list) =>
  list
    .filter((e) => e.dur >= 50000)
    .sort((a, b) => b.dur - a.dur)
    .slice(0, 18)
    .map((e) => ({
      name: e.name,
      durationMs: e.dur / 1000,
      pid: e.pid,
      tid: e.tid,
      data: e.args?.data,
    }));
const output = {
  ownCallbacks: own.length,
  maxOwnCallbackMs: Math.max(0, ...own.map((e) => e.dur || 0)) / 1000,
  ownOver100: own.filter((e) => e.dur > 100000).length,
  largestOwn: largest(own),
  largestSource: largest(main),
};
await writeFile(
  `${directory}/trace-summary.json`,
  JSON.stringify(output, null, 2),
);
console.log(JSON.stringify(output, null, 2));
