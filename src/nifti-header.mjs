import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";

const HEADER_BYTES = 348;
const headerCache = new Map();

function readNumber(buffer, offset, type, littleEndian) {
  const suffix = littleEndian ? "LE" : "BE";
  return buffer[`read${type}${suffix}`](offset);
}

function parseNifti1Header(buffer) {
  if (buffer.length < HEADER_BYTES) {
    throw new Error("NIfTI header is incomplete.");
  }
  const littleEndian = buffer.readInt32LE(0) === HEADER_BYTES;
  if (!littleEndian && buffer.readInt32BE(0) !== HEADER_BYTES) {
    throw new Error("Unsupported or invalid NIfTI-1 header.");
  }
  const int16 = (offset) => readNumber(buffer, offset, "Int16", littleEndian);
  const float32 = (offset) => readNumber(buffer, offset, "Float", littleEndian);
  const dimensionCount = int16(40);
  const dimensions = Array.from(
    { length: Math.min(3, dimensionCount) },
    (_, index) => int16(42 + index * 2),
  );
  const spacing = Array.from(
    { length: Math.min(3, dimensionCount) },
    (_, index) => float32(80 + index * 4),
  );
  const sformCode = int16(254);
  const sform = sformCode > 0
    ? Array.from({ length: 12 }, (_, index) => float32(280 + index * 4))
    : null;

  return {
    dimensions,
    spacing,
    datatypeCode: int16(70),
    bitDepth: int16(72),
    qformCode: int16(252),
    sformCode,
    sform,
    littleEndian,
    magic: buffer.subarray(344, 348).toString("ascii").replace(/\0/g, ""),
  };
}

function readCompressedHeader(filePath) {
  return new Promise((resolve, reject) => {
    const source = createReadStream(filePath);
    const gunzip = createGunzip();
    const chunks = [];
    let bytesRead = 0;
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
      source.destroy();
      gunzip.destroy();
    };

    gunzip.on("data", (chunk) => {
      if (settled) return;
      chunks.push(chunk);
      bytesRead += chunk.length;
      if (bytesRead >= HEADER_BYTES) {
        try {
          finish(resolve, Buffer.concat(chunks, bytesRead).subarray(0, HEADER_BYTES));
        } catch (error) {
          finish(reject, error);
        }
      }
    });
    gunzip.on("end", () => {
      if (!settled) finish(reject, new Error("Compressed NIfTI header is incomplete."));
    });
    source.on("error", (error) => finish(reject, error));
    gunzip.on("error", (error) => finish(reject, error));
    source.pipe(gunzip);
  });
}

export async function readNiftiHeader(filePath) {
  if (!headerCache.has(filePath)) {
    headerCache.set(
      filePath,
      readCompressedHeader(filePath).then(parseNifti1Header),
    );
  }
  return headerCache.get(filePath);
}

function arraysClose(left, right, tolerance = 1e-5) {
  return Boolean(left && right) && left.length === right.length && left.every(
    (value, index) => Math.abs(value - right[index]) <= tolerance,
  );
}

function compareGeometry(reference, candidate) {
  const issues = [];
  if (!arraysClose(reference.dimensions, candidate.dimensions, 0)) {
    issues.push("dimensions differ");
  }
  if (!arraysClose(reference.spacing, candidate.spacing)) {
    issues.push("voxel spacing differs");
  }
  if (reference.sform && candidate.sform && !arraysClose(reference.sform, candidate.sform, 1e-4)) {
    issues.push("spatial transform differs");
  } else if (Boolean(reference.sform) !== Boolean(candidate.sform)) {
    issues.push("spatial transform metadata differs");
  }
  return issues;
}

export async function inspectCaseGeometry(caseRecord) {
  const modalities = {};
  await Promise.all(Object.entries(caseRecord.modalities).map(async ([name, file]) => {
    try {
      modalities[name] = { ...(await readNiftiHeader(file.path)), error: null };
    } catch (error) {
      modalities[name] = { error: error.message };
    }
  }));

  const referenceModality = caseRecord.modalities.T1WI
    ? "T1WI"
    : caseRecord.availableModalities[0];
  const reference = modalities[referenceModality];
  let canOverlay = Boolean(reference && !reference.error);

  for (const name of caseRecord.availableModalities) {
    const geometry = modalities[name];
    if (geometry.error || reference.error) {
      geometry.alignedToReference = false;
      geometry.issues = [geometry.error || reference.error];
      canOverlay = false;
      continue;
    }
    geometry.issues = compareGeometry(reference, geometry);
    geometry.alignedToReference = geometry.issues.length === 0;
    if (!geometry.alignedToReference) canOverlay = false;
  }

  return { referenceModality, canOverlay, modalities };
}
