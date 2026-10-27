import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildCaseIndex } from "../src/data-index.mjs";
import { buildLabelIndex, joinCasesWithLabels } from "../src/label-index.mjs";
import {
  decodeNiftiVolume,
  scaledValue,
} from "../web/src/nifti-volume.js";

function asArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function decodeFile(filePath, modality) {
  return decodeNiftiVolume(asArrayBuffer(await readFile(filePath)), modality);
}

const [caseIndex, labelIndex] = await Promise.all([
  buildCaseIndex(),
  buildLabelIndex(),
]);
const dataset = joinCasesWithLabels(caseIndex, labelIndex);
const casesById = new Map(dataset.cases.map((record) => [record.id, record]));

const complete = casesById.get("TCGA-02-0003");
assert.equal(complete.availableModalities.length, 5);
assert.ok(complete.label);

const missingAdc = casesById.get("TCGA-HT-A61A");
assert.deepEqual(missingAdc.availableModalities, ["T1WI", "T1CE", "T2WI", "FLAIR"]);
assert.equal(missingAdc.modalities.ADC, undefined);

const noLabel = casesById.get("TCGA-EZ-7265A");
assert.ok(noLabel);
assert.equal(noLabel.label, null);

const expectedTypes = {
  T1WI: 4,
  T2WI: 16,
  ADC: 64,
};
const decoded = {};
for (const [modality, datatypeCode] of Object.entries(expectedTypes)) {
  const volume = await decodeFile(complete.modalities[modality].path, modality);
  assert.deepEqual(volume.dimensions, [240, 240, 155]);
  assert.deepEqual(volume.spacing, [1, 1, 1]);
  assert.equal(volume.datatypeCode, datatypeCode);
  assert.ok(Number.isFinite(volume.autoWindow.center));
  assert.ok(volume.autoWindow.width > 0);
  const centerIndex = 120 + 120 * 240 + 77 * 240 * 240;
  assert.ok(Number.isFinite(scaledValue(volume, centerIndex)));
  decoded[modality] = {
    datatypeCode,
    typedArray: volume.data.constructor.name,
    byteLength: volume.data.byteLength,
    autoWindow: volume.autoWindow,
  };
}

console.log(JSON.stringify({
  completeCase: complete.id,
  missingAdcCase: missingAdc.id,
  noLabelCase: noLabel.id,
  decoded,
}, null, 2));
