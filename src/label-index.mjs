import path from "node:path";
import ExcelJS from "exceljs";
import { DEFAULT_DATA_ROOT } from "./data-index.mjs";

export const DEFAULT_LABEL_FILE = path.join(DEFAULT_DATA_ROOT, "BraTS-TCGA.xlsx");

const FIELD_NAMES = [
  "tcgaId",
  "brats2020Id",
  "sex",
  "age",
  "histologyDiagnosis",
  "whoGrade",
  "gradeGroup",
  "ki67",
  "idhStatus",
  "oneP19qCodeletion",
  "mgmtMethylation",
  "tertPromoter",
];

function cellValue(cell) {
  const value = cell.value;
  if (value && typeof value === "object") {
    if ("result" in value) return value.result;
    if ("text" in value) return value.text;
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
  }
  return value ?? null;
}

export async function buildLabelIndex(labelFile = DEFAULT_LABEL_FILE) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(labelFile);
  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    throw new Error("The label workbook does not contain a worksheet.");
  }

  const sourceHeaders = FIELD_NAMES.map((_, index) =>
    cellValue(worksheet.getCell(1, index + 1)),
  );
  const labelsByCaseId = new Map();
  const duplicateCaseIds = [];

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const values = FIELD_NAMES.map((_, index) => cellValue(row.getCell(index + 1)));
    const tcgaId = values[0];
    if (!tcgaId) continue;

    if (labelsByCaseId.has(tcgaId)) {
      duplicateCaseIds.push(tcgaId);
      continue;
    }

    const record = Object.fromEntries(
      FIELD_NAMES.map((fieldName, index) => [fieldName, values[index]]),
    );
    record.sourceRow = rowNumber;
    labelsByCaseId.set(tcgaId, record);
  }

  return {
    labelFile,
    worksheetName: worksheet.name,
    sourceHeaders,
    labelsByCaseId,
    duplicateCaseIds,
    rowCount: labelsByCaseId.size,
  };
}

export function joinCasesWithLabels(caseIndex, labelIndex) {
  const imageCaseIds = new Set(caseIndex.cases.map((record) => record.id));
  const cases = caseIndex.cases.map((record) => ({
    ...record,
    label: labelIndex.labelsByCaseId.get(record.id) ?? null,
  }));

  return {
    ...caseIndex,
    cases,
    labelSummary: {
      labelRowCount: labelIndex.rowCount,
      matchedCaseCount: cases.filter((record) => record.label).length,
      imageCasesWithoutLabels: cases
        .filter((record) => !record.label)
        .map((record) => record.id),
      labelsWithoutImageCases: [...labelIndex.labelsByCaseId.keys()].filter(
        (caseId) => !imageCaseIds.has(caseId),
      ),
      duplicateCaseIds: labelIndex.duplicateCaseIds,
    },
  };
}
