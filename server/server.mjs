import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { buildCaseIndex, DEFAULT_DATA_ROOT } from "../src/data-index.mjs";
import {
  buildLabelIndex,
  joinCasesWithLabels,
} from "../src/label-index.mjs";
import { inspectCaseGeometry } from "../src/nifti-header.mjs";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SERVER_DIR, "..");
const WEB_ROOT = path.join(PROJECT_ROOT, "web");
const PORT = Number(process.env.PORT || 4173);
const HOST = "127.0.0.1";

const caseIndex = await buildCaseIndex(
  process.env.TCGA_DATA_ROOT || DEFAULT_DATA_ROOT,
);
const labelIndex = await buildLabelIndex(
  process.env.TCGA_LABEL_FILE || undefined,
);
const dataset = joinCasesWithLabels(caseIndex, labelIndex);
const casesById = new Map(dataset.cases.map((record) => [record.id, record]));

function publicCase(record, includeLabel = false) {
  return {
    id: record.id,
    availableModalities: record.availableModalities,
    missingCoreModalities: record.missingCoreModalities,
    missingOptionalModalities: record.missingOptionalModalities,
    warnings: record.warnings,
    ...(includeLabel ? { label: record.label } : {}),
  };
}

const app = express();
app.disable("x-powered-by");

app.get("/api/cases", (_request, response) => {
  response.json({
    summary: dataset.summary,
    labelSummary: dataset.labelSummary,
    cases: dataset.cases.map((record) => publicCase(record)),
  });
});

app.get("/api/cases/:caseId", async (request, response, next) => {
  const record = casesById.get(request.params.caseId);
  if (!record) {
    response.status(404).json({ error: "Case not found." });
    return;
  }
  try {
    response.json({
      ...publicCase(record, true),
      geometry: await inspectCaseGeometry(record),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/cases/:caseId/modalities/:modality/file", (request, response) => {
  const record = casesById.get(request.params.caseId);
  const file = record?.modalities[request.params.modality];
  if (!file) {
    response.status(404).json({ error: "Modality not found for this case." });
    return;
  }

  response.type("application/gzip");
  response.setHeader("Content-Disposition", `inline; filename="${file.filename}"`);
  response.sendFile(file.path);
});

const vite = await createViteServer({
  root: WEB_ROOT,
  server: { middlewareMode: true },
  appType: "spa",
});
app.use(vite.middlewares);

app.listen(PORT, HOST, () => {
  console.log(`TCGA MRI Viewer: http://${HOST}:${PORT}`);
  console.log(
    `Indexed ${dataset.summary.caseCount} cases; ${dataset.labelSummary.matchedCaseCount} have labels.`,
  );
});
