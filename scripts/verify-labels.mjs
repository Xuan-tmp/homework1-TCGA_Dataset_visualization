import assert from "node:assert/strict";
import { buildCaseIndex } from "../src/data-index.mjs";
import { buildLabelIndex, joinCasesWithLabels } from "../src/label-index.mjs";

const [caseIndex, labelIndex] = await Promise.all([
  buildCaseIndex(),
  buildLabelIndex(),
]);
const joined = joinCasesWithLabels(caseIndex, labelIndex);

assert.equal(labelIndex.rowCount, 242);
assert.deepEqual(labelIndex.duplicateCaseIds, []);
assert.equal(joined.labelSummary.matchedCaseCount, 242);
assert.deepEqual(joined.labelSummary.imageCasesWithoutLabels, ["TCGA-EZ-7265A"]);
assert.deepEqual(joined.labelSummary.labelsWithoutImageCases, []);
assert.deepEqual(labelIndex.sourceHeaders, [
  "TCGA编号",
  "BraTS2020编号",
  "Sex",
  "Age",
  "Histology diagnosis",
  "WHO Grade",
  "HGG-LGG",
  "Ki67",
  "IDH status",
  "1p19q codetion",
  "MGMT mythelation",
  "TERT promoter",
]);

console.log(JSON.stringify(joined.labelSummary, null, 2));
