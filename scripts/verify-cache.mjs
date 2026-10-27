import assert from "node:assert/strict";
import { VolumeCache } from "../web/src/volume-cache.js";

const cache = new VolumeCache({ maxEntries: 3, maxBytes: 100 });
cache.set("a", { id: "a" }, 30);
cache.set("b", { id: "b" }, 30);
cache.set("c", { id: "c" }, 30);
assert.equal(cache.size, 3);
assert.equal(cache.sizeBytes, 90);

assert.equal(cache.get("a").id, "a");
cache.set("d", { id: "d" }, 30);
assert.equal(cache.get("b"), null, "Least-recently-used entry should be removed");
assert.deepEqual([...cache.entries.keys()], ["c", "a", "d"]);

cache.set("large", { id: "large" }, 90);
assert.deepEqual([...cache.entries.keys()], ["large"]);
assert.equal(cache.sizeBytes, 90);

cache.set("oversized", { id: "oversized" }, 140);
assert.deepEqual([...cache.entries.keys()], ["oversized"]);
assert.equal(cache.sizeBytes, 140, "One active oversized volume remains usable");

console.log(JSON.stringify({ maxEntries: 3, maxBytes: 100, lruVerified: true }));
