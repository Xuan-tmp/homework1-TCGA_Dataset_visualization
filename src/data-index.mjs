import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CORE_MODALITIES = ["T1WI", "T1CE", "T2WI", "FLAIR"];
export const OPTIONAL_MODALITIES = ["ADC"];
export const ALL_MODALITIES = [...CORE_MODALITIES, ...OPTIONAL_MODALITIES];

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATA_ROOT = path.resolve(MODULE_DIR, "..", "..", "TCGA");

function modalityFromFilename(caseId, filename) {
  const prefix = `${caseId}_`;
  const suffix = ".nii.gz";

  if (!filename.startsWith(prefix) || !filename.endsWith(suffix)) {
    return null;
  }

  const modality = filename.slice(prefix.length, -suffix.length);
  return ALL_MODALITIES.includes(modality) ? modality : null;
}

async function scanCase(caseId, casePath) {
  const entries = await readdir(casePath, { withFileTypes: true });
  const modalities = {};
  const unexpectedFiles = [];
  const warnings = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      warnings.push(`Unexpected nested entry: ${entry.name}`);
      continue;
    }

    const modality = modalityFromFilename(caseId, entry.name);
    if (!modality) {
      unexpectedFiles.push(entry.name);
      continue;
    }

    if (modalities[modality]) {
      warnings.push(`Duplicate modality: ${modality}`);
      continue;
    }

    const filePath = path.join(casePath, entry.name);
    const fileStat = await stat(filePath);
    modalities[modality] = {
      filename: entry.name,
      path: filePath,
      sizeBytes: fileStat.size,
    };
  }

  const missingCoreModalities = CORE_MODALITIES.filter(
    (modality) => !modalities[modality],
  );
  const missingOptionalModalities = OPTIONAL_MODALITIES.filter(
    (modality) => !modalities[modality],
  );

  if (missingCoreModalities.length > 0) {
    warnings.push(`Missing core modalities: ${missingCoreModalities.join(", ")}`);
  }
  if (missingOptionalModalities.length > 0) {
    warnings.push(
      `Missing optional modalities: ${missingOptionalModalities.join(", ")}`,
    );
  }
  if (unexpectedFiles.length > 0) {
    warnings.push(`Unexpected files: ${unexpectedFiles.join(", ")}`);
  }

  return {
    id: caseId,
    path: casePath,
    modalities,
    availableModalities: ALL_MODALITIES.filter(
      (modality) => modalities[modality],
    ),
    missingCoreModalities,
    missingOptionalModalities,
    unexpectedFiles,
    warnings,
  };
}

export async function buildCaseIndex(dataRoot = DEFAULT_DATA_ROOT) {
  const entries = await readdir(dataRoot, { withFileTypes: true });
  const caseEntries = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("TCGA-"))
    .sort((left, right) => left.name.localeCompare(right.name));

  const cases = await Promise.all(
    caseEntries.map((entry) =>
      scanCase(entry.name, path.join(dataRoot, entry.name)),
    ),
  );

  const modalityCounts = Object.fromEntries(
    ALL_MODALITIES.map((modality) => [
      modality,
      cases.filter((caseRecord) => caseRecord.modalities[modality]).length,
    ]),
  );

  return {
    dataRoot,
    generatedAt: new Date().toISOString(),
    cases,
    summary: {
      caseCount: cases.length,
      imageFileCount: Object.values(modalityCounts).reduce(
        (total, count) => total + count,
        0,
      ),
      modalityCounts,
      completeFiveModalityCases: cases.filter(
        (caseRecord) => caseRecord.availableModalities.length === 5,
      ).length,
      missingAdcCases: cases.filter(
        (caseRecord) => !caseRecord.modalities.ADC,
      ).length,
      casesMissingCoreModalities: cases
        .filter((caseRecord) => caseRecord.missingCoreModalities.length > 0)
        .map((caseRecord) => caseRecord.id),
      casesWithUnexpectedFiles: cases
        .filter((caseRecord) => caseRecord.unexpectedFiles.length > 0)
        .map((caseRecord) => caseRecord.id),
    },
  };
}
