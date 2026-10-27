import assert from "node:assert/strict";
import { buildCaseIndex } from "../src/data-index.mjs";
import { buildLabelIndex, joinCasesWithLabels } from "../src/label-index.mjs";
import { inspectCaseGeometry } from "../src/nifti-header.mjs";

const [caseIndex, labelIndex] = await Promise.all([
  buildCaseIndex(),
  buildLabelIndex(),
]);
const dataset = joinCasesWithLabels(caseIndex, labelIndex);

const missingAdc = dataset.cases.filter((record) => !record.modalities.ADC);
assert.equal(missingAdc.length, 27);
assert.deepEqual(dataset.labelSummary.imageCasesWithoutLabels, ["TCGA-EZ-7265A"]);

const lowercaseSex = dataset.cases.filter((record) => record.label?.sex === "f");
assert.equal(lowercaseSex.length, 1);
const allKi67Missing = dataset.cases.every(
  (record) => !record.label || record.label.ki67 === "NA",
);
assert.equal(allKi67Missing, true);

let geometryMismatchCount = 0;
let headerErrorCount = 0;
for (const record of dataset.cases) {
  const geometry = await inspectCaseGeometry(record);
  if (!geometry.canOverlay) geometryMismatchCount += 1;
  headerErrorCount += Object.values(geometry.modalities).filter((item) => item.error).length;
}
assert.equal(geometryMismatchCount, 0);
assert.equal(headerErrorCount, 0);

console.log(JSON.stringify({
  missingAdcCases: missingAdc.length,
  imageCasesWithoutLabels: dataset.labelSummary.imageCasesWithoutLabels,
  lowercaseSexCases: lowercaseSex.map((record) => record.id),
  allKi67Missing,
  geometryMismatchCount,
  headerErrorCount,
}, null, 2));
