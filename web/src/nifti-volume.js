import * as nifti from "nifti-reader-js";

function typedImageData(header, imageBuffer) {
  const typeMap = new Map([
    [2, Uint8Array],
    [4, Int16Array],
    [8, Int32Array],
    [16, Float32Array],
    [64, Float64Array],
    [256, Int8Array],
    [512, Uint16Array],
    [768, Uint32Array],
  ]);
  const Type = typeMap.get(header.datatypeCode);
  if (!Type) throw new Error(`暂不支持 NIfTI 数据类型 ${header.datatypeCode}。`);
  return new Type(imageBuffer);
}

export function scaledValue(volume, index) {
  return volume.data[index] * volume.slope + volume.intercept;
}

export function calculateAutoWindow(volume) {
  const values = [];
  const step = Math.max(1, Math.floor(volume.data.length / 180000));
  for (let index = 0; index < volume.data.length; index += step) {
    const value = scaledValue(volume, index);
    if (Number.isFinite(value) && value !== 0) values.push(value);
  }
  if (values.length === 0) values.push(0, 1);
  values.sort((a, b) => a - b);
  const low = values[Math.floor((values.length - 1) * 0.01)];
  const high = values[Math.floor((values.length - 1) * 0.99)];
  const width = Math.max(Number.EPSILON, high - low);
  return { center: low + width / 2, width };
}

export function decodeNiftiVolume(compressed, modality = null) {
  const raw = nifti.isCompressed(compressed)
    ? nifti.decompress(compressed)
    : compressed;
  if (!nifti.isNIFTI(raw)) throw new Error("文件不是有效的 NIfTI 影像。");
  const header = nifti.readHeader(raw);
  const image = nifti.readImage(header, raw);
  const volume = {
    data: typedImageData(header, image),
    dimensions: header.dims.slice(1, 4).map(Number),
    spacing: header.pixDims.slice(1, 4).map(Number),
    slope: Number(header.scl_slope) || 1,
    intercept: Number(header.scl_inter) || 0,
    datatypeCode: header.datatypeCode,
    modality,
  };
  volume.autoWindow = calculateAutoWindow(volume);
  return volume;
}
