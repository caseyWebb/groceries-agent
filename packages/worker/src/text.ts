// The text helpers moved to the runtime-agnostic @yamp/contract package
// (shared with the satellite). Re-exported here so existing `./text.js` importers
// (feeds.ts, discovery.ts, …) are unchanged.

export { cleanText, truncate, decodeEntities } from "@yamp/contract";
