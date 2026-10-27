import assert from "node:assert/strict";
import { buildCaseIndex, DEFAULT_DATA_ROOT } from "../src/data-index.mjs";

const index = await buildCaseIndex();

assert.equal(index.dataRoot, DEFAULT_DATA_ROOT);
assert.equal(index.summary.caseCount, 243);
assert.equal(index.summary.imageFileCount, 1188);
assert.deepEqual(index.summary.modalityCounts, {
  T1WI: 243,
  T1CE: 243,
  T2WI: 243,
  FLAIR: 243,
  ADC: 216,
});
assert.equal(index.summary.completeFiveModalityCases, 216);
assert.equal(index.summary.missingAdcCases, 27);
assert.deepEqual(index.summary.casesMissingCoreModalities, []);
assert.deepEqual(index.summary.casesWithUnexpectedFiles, []);

const unmatchedCase = index.cases.find(
  (caseRecord) => caseRecord.id === "TCGA-EZ-7265A",
);
assert.ok(unmatchedCase, "Expected TCGA-EZ-7265A in the image index");
assert.deepEqual(unmatchedCase.availableModalities, [
  "T1WI",
  "T1CE",
  "T2WI",
  "FLAIR",
]);

console.log(JSON.stringify(index.summary, null, 2));
