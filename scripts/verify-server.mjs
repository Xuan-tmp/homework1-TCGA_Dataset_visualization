import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as nifti from "nifti-reader-js";

const port = 4187;
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server/server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
server.stderr.on("data", (chunk) => { stderr += chunk; });

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server startup timed out.")), 30000);
    server.stdout.on("data", (chunk) => {
      if (chunk.toString().includes(baseUrl)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited with code ${code}. ${stderr}`));
    });
  });

  const casesResponse = await fetch(`${baseUrl}/api/cases`);
  assert.equal(casesResponse.status, 200);
  const cases = await casesResponse.json();
  assert.equal(cases.summary.caseCount, 243);
  assert.equal(cases.labelSummary.matchedCaseCount, 242);

  const detailResponse = await fetch(`${baseUrl}/api/cases/TCGA-02-0003`);
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json();
  assert.equal(detail.label.histologyDiagnosis, "Glioblastoma");
  assert.equal(detail.geometry.canOverlay, true);
  assert.deepEqual(detail.geometry.modalities.FLAIR.dimensions, [240, 240, 155]);

  const missingAdcDetail = await fetch(`${baseUrl}/api/cases/TCGA-HT-A61A`);
  assert.equal(missingAdcDetail.status, 200);
  const missingAdcFile = await fetch(
    `${baseUrl}/api/cases/TCGA-HT-A61A/modalities/ADC/file`,
  );
  assert.equal(missingAdcFile.status, 404);

  const noLabelResponse = await fetch(`${baseUrl}/api/cases/TCGA-EZ-7265A`);
  assert.equal(noLabelResponse.status, 200);
  const noLabel = await noLabelResponse.json();
  assert.equal(noLabel.label, null);

  const imageResponse = await fetch(
    `${baseUrl}/api/cases/TCGA-02-0003/modalities/FLAIR/file`,
  );
  assert.equal(imageResponse.status, 200);
  const compressed = await imageResponse.arrayBuffer();
  const raw = nifti.isCompressed(compressed)
    ? nifti.decompress(compressed)
    : compressed;
  assert.ok(nifti.isNIFTI(raw));
  const header = nifti.readHeader(raw);
  assert.deepEqual(header.dims.slice(1, 4), [240, 240, 155]);
  assert.deepEqual(header.pixDims.slice(1, 4), [1, 1, 1]);

  console.log(JSON.stringify({
    caseCount: cases.summary.caseCount,
    matchedLabels: cases.labelSummary.matchedCaseCount,
    testedCase: detail.id,
    testedModality: "FLAIR",
    dimensions: header.dims.slice(1, 4),
  }, null, 2));
} finally {
  server.kill();
}
