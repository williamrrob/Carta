// sync.js merges two devices' progress per word. These are the cases that matter:
// nothing learned on either device is lost, the later change to a word wins, and a bookmark
// removed on one device stays removed.
"use strict";
const assert = require("assert");
const path = require("path");
const store = {};
global.window = { addEventListener() {}, dispatchEvent() {} };
global.document = { addEventListener() {}, visibilityState: "visible" };
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
global.setInterval = () => 0;
const S = require(path.join(__dirname, "..", "sync.js"));

const T = 1.7e12;
const st = (o) => Object.assign({ v: 2, z: 45, known: {}, learn: {}, seen: {}, author: null, n: 0 }, o);

// a word tapped on the phone and another on the Mac: both are on the pile afterwards
let m = S._mergeRead(st({ learn: { Haus: { n: 1, s: 0, due: T, m: T } }, n: 3, mt: T }), st({ learn: { Baum: { n: 2, s: 1, due: T, m: T + 5 } }, n: 7, mt: T + 5 }));
assert.deepStrictEqual(Object.keys(m.learn).sort(), ["Baum", "Haus"]);
assert.strictEqual(m.n, 7);
console.log("ok - words from both devices are kept");

// the same word on both: the later change wins, whichever side it is on
m = S._mergeRead(st({ learn: { Haus: { n: 1, s: 0, due: T, m: T } } }), st({ learn: { Haus: { n: 1, s: 3, due: T + 9, m: T + 9 } } }));
assert.strictEqual(m.learn.Haus.s, 3);
m = S._mergeRead(st({ learn: { Haus: { n: 4, s: 0, due: T + 20, m: T + 20 } } }), st({ learn: { Haus: { n: 1, s: 3, due: T + 9, m: T + 9 } } }));
assert.strictEqual(m.learn.Haus.n, 4);
console.log("ok - the later change to a word wins");

// learned (or "I know this") on one device after it was tapped on the other: it is known
m = S._mergeRead(st({ learn: { Haus: { n: 1, s: 4, due: T, m: T } } }), st({ known: { Haus: T + 50 } }));
assert.ok(m.known.Haus && !m.learn.Haus);
// tapped again later on the other device: back on the pile
m = S._mergeRead(st({ known: { Haus: T + 50 } }), st({ learn: { Haus: { n: 2, s: 0, due: T, m: T + 90 } } }));
assert.ok(m.learn.Haus && !m.known.Haus);
// only read past on one device (known: 1), tapped on the other: still to learn
m = S._mergeRead(st({ known: { Haus: 1 } }), st({ learn: { Haus: { n: 1, s: 0, due: T } } }));
assert.ok(m.learn.Haus && !m.known.Haus);
console.log("ok - known and still-learning are settled by time");

// level and recent scores come from the device used last; the excerpt in hand stays this device's
m = S._mergeRead(st({ z: 45, mt: T, cur: { t: "Hier." }, draft: "Here." }), st({ z: 41, hist: [1, 1], mt: T + 1, cur: { t: "Dort." } }));
assert.strictEqual(m.z, 41); assert.strictEqual(m.cur.t, "Hier."); assert.strictEqual(m.draft, "Here.");
console.log("ok - level follows the latest device; the open excerpt stays local");

// a device with nothing yet takes everything; days and seen excerpts add up
m = S._mergeRead(null, st({ learn: { Haus: { n: 1, s: 0, due: T } }, days: { "2026-11-12": 4 } }));
assert.ok(m.learn.Haus);
m = S._mergeRead(st({ days: { "2026-11-12": 2, "2026-11-11": 1 }, seen: { a: 1 } }), st({ days: { "2026-11-12": 4 }, seen: { b: 1 } }));
assert.deepStrictEqual(m.days, { "2026-11-12": 4, "2026-11-11": 1 }); assert.deepStrictEqual(Object.keys(m.seen).sort(), ["a", "b"]);
console.log("ok - a new device adopts the stored progress");

// bookmarks: added on either side stay; removed on one side (it was there at the last sync) goes
const key = (x) => x;
assert.deepStrictEqual(S._mergeList(["a", "b"], ["b", "c"], null, key), ["a", "b", "c"]);
assert.deepStrictEqual(S._mergeList(["a"], ["a", "b"], ["a", "b"], key), ["a"]);          // removed here
assert.deepStrictEqual(S._mergeList(["a", "b"], ["a"], ["a", "b"], key), ["a"]);          // removed there
assert.deepStrictEqual(S._mergeList(["a", "b", "x"], ["a", "y"], ["a", "b"], key), ["a", "x", "y"]);
console.log("ok - bookmarks merge three ways");
console.log("Sync merges cleanly.");
