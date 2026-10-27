import { VolumeCache } from "./volume-cache.js";
import {
  decodeNiftiVolume,
  scaledValue,
} from "./nifti-volume.js";
import "./styles.css";

let vtkModulesPromise = null;

function loadVtkModules() {
  if (!vtkModulesPromise) {
    vtkModulesPromise = Promise.all([
      import("@kitware/vtk.js/Rendering/Profiles/Volume"),
      import("@kitware/vtk.js/Common/Core/DataArray"),
      import("@kitware/vtk.js/Common/DataModel/ImageData"),
      import("@kitware/vtk.js/Common/DataModel/PiecewiseFunction"),
      import("@kitware/vtk.js/Rendering/Core/ColorTransferFunction"),
      import("@kitware/vtk.js/Rendering/Core/Volume"),
      import("@kitware/vtk.js/Rendering/Core/VolumeMapper"),
      import("@kitware/vtk.js/Rendering/Misc/GenericRenderWindow"),
    ]).then(([
      _profile, dataArray, imageData, piecewiseFunction,
      colorTransferFunction, volume, volumeMapper, genericRenderWindow,
    ]) => ({
      vtkDataArray: dataArray.default,
      vtkImageData: imageData.default,
      vtkPiecewiseFunction: piecewiseFunction.default,
      vtkColorTransferFunction: colorTransferFunction.default,
      vtkVolume: volume.default,
      vtkVolumeMapper: volumeMapper.default,
      vtkGenericRenderWindow: genericRenderWindow.default,
    }));
  }
  return vtkModulesPromise;
}

const app = document.querySelector("#app");

app.innerHTML = `
  <main class="app-shell">
    <header class="topbar">
      <div class="brand"><strong>TCGA MRI Viewer</strong><span>本地多模态影像浏览</span></div>
      <div class="top-controls">
        <label class="field">病例 <select id="case-select" aria-label="选择病例"></select></label>
        <label class="field">模态 <select id="modality-select" aria-label="选择模态"></select></label>
        <div id="status" class="status" aria-live="polite">正在读取病例索引…</div>
      </div>
    </header>
    <div class="workspace">
      <aside class="sidebar">
        <div id="case-warning" class="notice hidden"></div>
        <h2 id="case-title">病例信息</h2>
        <dl id="case-labels" class="label-grid"></dl>
        <h3>影像信息</h3>
        <dl id="image-meta" class="label-grid"></dl>
      </aside>
      <section class="viewer-area">
        <div id="toolbar" class="toolbar hidden">
          <div class="control"><label for="window-center">窗位</label><input id="window-center" type="number" step="any"></div>
          <div class="control"><label for="window-width">窗宽</label><input id="window-width" type="number" min="0.000001" step="any"></div>
          <button id="auto-window" type="button">自动范围</button>
          <div class="control"><label for="colormap">色图</label><select id="colormap"><option value="gray">灰度</option><option value="hot">热度</option><option value="viridis">Viridis</option></select></div>
          <button id="reset-view" type="button">复位视图</button>
          <div class="spacer"></div>
          <div id="cache-summary" class="volume-meta">缓存：0</div>
          <div id="voxel-readout" class="voxel-readout">体素：—</div>
        </div>
        <div id="empty-state" class="empty-state">请选择病例和模态</div>
        <div id="view-grid" class="view-grid hidden">
          ${viewPanel("axial", "轴位", "Z")}
          ${viewPanel("coronal", "冠状位", "Y")}
          ${viewPanel("sagittal", "矢状位", "X")}
          <article class="view-panel volume-panel">
            <header><strong>三维体绘制</strong><span id="volume-quality">降采样预览</span></header>
            <div id="volume-3d" class="volume-stage" aria-label="交互式三维 MRI 体绘制"></div>
            <div class="volume-controls">
              <label>阈值 <input id="volume-threshold" type="range" min="0" max="100" value="22"><output id="volume-threshold-output">22%</output></label>
              <label>透明度 <input id="volume-opacity" type="range" min="1" max="100" value="45"><output id="volume-opacity-output">45%</output></label>
              <button id="reset-volume" type="button">复位 3D</button>
            </div>
          </article>
        </div>
      </section>
    </div>
  </main>`;

function viewPanel(id, title, axis) {
  return `<article class="view-panel" data-view="${id}">
    <header><strong>${title}</strong><span>${axis} 轴</span></header>
    <div class="canvas-stage"><canvas id="${id}-canvas" aria-label="${title} MRI 切片"></canvas></div>
    <label class="slice-control">切片 <input id="${id}-slider" type="range" min="0" max="0" value="0"><output id="${id}-output">0 / 0</output></label>
  </article>`;
}

const elements = Object.fromEntries(
  [
    "case-select", "modality-select", "status", "case-warning", "case-title",
    "case-labels", "image-meta", "toolbar", "window-center", "window-width",
    "auto-window", "colormap", "reset-view", "voxel-readout", "empty-state", "view-grid",
    "volume-3d", "volume-quality", "volume-threshold", "volume-threshold-output",
    "volume-opacity", "volume-opacity-output", "reset-volume",
    "cache-summary",
  ].map((id) => [id, document.getElementById(id)]),
);

const views = Object.fromEntries(
  ["axial", "coronal", "sagittal"].map((name) => [name, {
    canvas: document.getElementById(`${name}-canvas`),
    slider: document.getElementById(`${name}-slider`),
    output: document.getElementById(`${name}-output`),
    stage: document.querySelector(`[data-view="${name}"] .canvas-stage`),
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  }]),
);

const state = {
  cases: [],
  currentCase: null,
  volume: null,
  position: { x: 0, y: 0, z: 0 },
  windowCenter: 0,
  windowWidth: 1,
  autoWindow: { center: 0, width: 1 },
  loadToken: 0,
  caseLoadToken: 0,
  loadController: null,
  volume3d: null,
  volume3dPromise: null,
  volumeCache: new VolumeCache(),
  caseCache: new Map(),
};

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

function displayValue(value) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function renderDefinitionList(target, entries) {
  target.replaceChildren();
  for (const [label, value] of entries) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = displayValue(value);
    target.append(dt, dd);
  }
}

async function loadCase(caseId) {
  const caseToken = ++state.caseLoadToken;
  setStatus(`正在读取 ${caseId}…`);
  let caseRecord;
  if (state.caseCache.has(caseId)) {
    caseRecord = state.caseCache.get(caseId);
  } else {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}`);
    if (!response.ok) throw new Error("病例信息读取失败。");
    caseRecord = await response.json();
    state.caseCache.set(caseId, caseRecord);
  }
  if (caseToken !== state.caseLoadToken) return;
  state.currentCase = caseRecord;
  elements["case-title"].textContent = state.currentCase.id;

  const label = state.currentCase.label;
  renderDefinitionList(elements["case-labels"], label ? [
    ["BraTS 2020", label.brats2020Id], ["性别", label.sex], ["年龄", label.age],
    ["组织学诊断", label.histologyDiagnosis], ["WHO 分级", label.whoGrade],
    ["HGG / LGG", label.gradeGroup], ["Ki67", label.ki67],
    ["IDH", label.idhStatus], ["1p/19q", label.oneP19qCodeletion],
    ["MGMT", label.mgmtMethylation], ["TERT promoter", label.tertPromoter],
  ] : [["标签", "无对应记录"]]);

  const warningMessages = [...state.currentCase.warnings];
  if (!label) warningMessages.unshift("该病例没有对应的 Excel 标签记录。");
  if (label?.sex === "f") {
    warningMessages.push("Sex 字段使用小写 f；工具保留原始值，未自动改写。");
  }
  if (state.currentCase.geometry && !state.currentCase.geometry.canOverlay) {
    warningMessages.push("模态空间几何不一致，不应直接进行多模态叠加。");
  }
  elements["case-warning"].textContent = warningMessages.join(" ");
  elements["case-warning"].classList.toggle("hidden", warningMessages.length === 0);

  elements["modality-select"].replaceChildren();
  for (const modality of state.currentCase.availableModalities) {
    const option = new Option(modality, modality);
    elements["modality-select"].add(option);
  }
  const preferred = state.currentCase.availableModalities.includes("FLAIR")
    ? "FLAIR" : state.currentCase.availableModalities[0];
  elements["modality-select"].value = preferred;
  await loadVolume(preferred);
}

async function loadVolume(modality) {
  const token = ++state.loadToken;
  const caseId = state.currentCase.id;
  const cacheKey = `${caseId}:${modality}`;
  state.loadController?.abort();
  state.loadController = new AbortController();
  setStatus(`正在加载 ${caseId} · ${modality}…`);
  elements.toolbar.classList.add("hidden");
  elements["view-grid"].classList.add("hidden");
  elements["empty-state"].classList.remove("hidden");
  elements["empty-state"].textContent = "正在解压并读取三维影像…";

  let volume = state.volumeCache.get(cacheKey);
  const loadedFromCache = Boolean(volume);
  if (!volume) {
    const response = await fetch(
      `/api/cases/${encodeURIComponent(caseId)}/modalities/${modality}/file`,
      { signal: state.loadController.signal },
    );
    if (!response.ok) throw new Error("影像文件读取失败。");
    const compressed = await response.arrayBuffer();
    if (token !== state.loadToken) return;
    volume = decodeNiftiVolume(compressed, modality);
    state.volumeCache.set(cacheKey, volume, volume.data.byteLength);
  }
  if (token !== state.loadToken) return;
  state.volume = volume;
  const { dimensions, spacing } = volume;
  state.position = {
    x: Math.floor(dimensions[0] / 2), y: Math.floor(dimensions[1] / 2), z: Math.floor(dimensions[2] / 2),
  };
  state.autoWindow = volume.autoWindow;
  applyAutoWindow();
  configureSliders();
  resetViews();
  renderDefinitionList(elements["image-meta"], [
    ["模态", modality], ["尺寸", dimensions.join(" × ")],
    ["体素间距", `${spacing.map((v) => v.toFixed(2)).join(" × ")} mm`],
    ["数据类型代码", volume.datatypeCode], ["载入来源", loadedFromCache ? "内存缓存" : "本地文件"],
    ["空间匹配", state.currentCase.geometry?.modalities?.[modality]?.alignedToReference === false ? "不匹配" : "匹配"],
  ]);
  elements["empty-state"].classList.add("hidden");
  elements["view-grid"].classList.remove("hidden");
  elements.toolbar.classList.remove("hidden");
  drawAllViews();
  await renderVolume3d(volume);
  if (token !== state.loadToken) return;
  updateCacheSummary();
  setStatus(`${caseId} · ${modality}${loadedFromCache ? " · 已缓存" : ""}`);
}

function updateCacheSummary() {
  const megabytes = state.volumeCache.sizeBytes / (1024 * 1024);
  elements["cache-summary"].textContent = `缓存：${state.volumeCache.size} 个体积 · ${megabytes.toFixed(1)} MB`;
}

function downsampleVolume(volume, maxDimension = 128) {
  const [nx, ny, nz] = volume.dimensions;
  const step = Math.max(1, Math.ceil(Math.max(nx, ny, nz) / maxDimension));
  const dimensions = [Math.ceil(nx / step), Math.ceil(ny / step), Math.ceil(nz / step)];
  const values = new Float32Array(dimensions[0] * dimensions[1] * dimensions[2]);
  let outputIndex = 0;
  for (let z = 0; z < nz; z += step) {
    for (let y = 0; y < ny; y += step) {
      const rowStart = y * nx + z * nx * ny;
      for (let x = 0; x < nx; x += step) {
        values[outputIndex] = scaledValue(volume, rowStart + x);
        outputIndex += 1;
      }
    }
  }
  return {
    values,
    dimensions,
    spacing: volume.spacing.map((value) => value * step),
    step,
  };
}

async function ensureVolumeRenderer() {
  if (state.volume3d) return state.volume3d;
  if (!state.volume3dPromise) {
    state.volume3dPromise = (async () => {
      const {
        vtkPiecewiseFunction, vtkColorTransferFunction, vtkVolume,
        vtkVolumeMapper, vtkGenericRenderWindow,
      } = await loadVtkModules();
      const genericRenderWindow = vtkGenericRenderWindow.newInstance({
        background: [0.008, 0.012, 0.02],
      });
      genericRenderWindow.setContainer(elements["volume-3d"]);
      const mapper = vtkVolumeMapper.newInstance();
      const actor = vtkVolume.newInstance();
      actor.setMapper(mapper);
      const colorTransfer = vtkColorTransferFunction.newInstance();
      const opacityTransfer = vtkPiecewiseFunction.newInstance();
      actor.getProperty().setRGBTransferFunction(0, colorTransfer);
      actor.getProperty().setScalarOpacity(0, opacityTransfer);
      actor.getProperty().setInterpolationTypeToLinear();
      actor.getProperty().setShade(true);
      actor.getProperty().setAmbient(0.25);
      actor.getProperty().setDiffuse(0.85);
      actor.getProperty().setSpecular(0.2);
      genericRenderWindow.getRenderer().addVolume(actor);
      const resizeObserver = new ResizeObserver(() => genericRenderWindow.resize());
      resizeObserver.observe(elements["volume-3d"]);
      state.volume3d = {
        genericRenderWindow, mapper, actor, colorTransfer, opacityTransfer,
        resizeObserver, scalarRange: [0, 1], downsampled: null,
      };
      return state.volume3d;
    })();
  }
  return state.volume3dPromise;
}

function transferColor(stops, t) {
  const position = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(position));
  const fraction = position - index;
  return stops[index].map(
    (value, channel) => (value + (stops[index + 1][channel] - value) * fraction) / 255,
  );
}

function updateVolumeTransferFunctions() {
  if (!state.volume3d?.downsampled) return;
  const pipeline = state.volume3d;
  const [low, high] = pipeline.scalarRange;
  const thresholdFraction = Number(elements["volume-threshold"].value) / 100;
  const maximumOpacity = Number(elements["volume-opacity"].value) / 100;
  const threshold = low + (high - low) * thresholdFraction;
  const rampEnd = Math.min(high, threshold + (high - low) * 0.18);
  const colormap = elements.colormap.value;

  pipeline.colorTransfer.removeAllPoints();
  if (colormap === "gray") {
    pipeline.colorTransfer.addRGBPoint(low, 0, 0, 0);
    pipeline.colorTransfer.addRGBPoint(high, 1, 1, 1);
  } else {
    const stops = colormap === "hot"
      ? [[0, 0, 0], [255, 0, 0], [255, 255, 0], [255, 255, 255]]
      : [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
    stops.forEach((_, index) => {
      const fraction = index / (stops.length - 1);
      const color = transferColor(stops, fraction);
      pipeline.colorTransfer.addRGBPoint(low + (high - low) * fraction, ...color);
    });
  }

  pipeline.opacityTransfer.removeAllPoints();
  pipeline.opacityTransfer.addPoint(low, 0);
  pipeline.opacityTransfer.addPoint(threshold, 0);
  pipeline.opacityTransfer.addPoint(rampEnd, maximumOpacity * 0.55);
  pipeline.opacityTransfer.addPoint(high, maximumOpacity);
  pipeline.genericRenderWindow.getRenderWindow().render();
  elements["volume-threshold-output"].textContent = `${Math.round(thresholdFraction * 100)}%`;
  elements["volume-opacity-output"].textContent = `${Math.round(maximumOpacity * 100)}%`;
}

async function renderVolume3d(volume = state.volume) {
  if (!volume) return;
  const pipeline = await ensureVolumeRenderer();
  const { vtkDataArray, vtkImageData } = await loadVtkModules();
  const downsampled = downsampleVolume(volume);
  const imageData = vtkImageData.newInstance();
  imageData.setDimensions(...downsampled.dimensions);
  imageData.setSpacing(...downsampled.spacing);
  imageData.getPointData().setScalars(vtkDataArray.newInstance({
    name: "MRI intensity",
    values: downsampled.values,
    numberOfComponents: 1,
  }));
  pipeline.mapper.setInputData(imageData);
  pipeline.mapper.setSampleDistance(Math.min(...downsampled.spacing) * 0.7);
  pipeline.scalarRange = [
    volume.autoWindow.center - volume.autoWindow.width / 2,
    volume.autoWindow.center + volume.autoWindow.width / 2,
  ];
  pipeline.downsampled = downsampled;
  updateVolumeTransferFunctions();
  pipeline.genericRenderWindow.getRenderer().resetCamera();
  pipeline.genericRenderWindow.resize();
  pipeline.genericRenderWindow.getRenderWindow().render();
  elements["volume-quality"].textContent = downsampled.step === 1
    ? `${downsampled.dimensions.join(" × ")} · 原始分辨率`
    : `${downsampled.dimensions.join(" × ")} · ${downsampled.step}× 降采样`;
}

function resetVolumeCamera() {
  if (!state.volume3d) return;
  state.volume3d.genericRenderWindow.getRenderer().resetCamera();
  state.volume3d.genericRenderWindow.getRenderWindow().render();
}

function configureSliders() {
  const [nx, ny, nz] = state.volume.dimensions;
  const config = { axial: [nz - 1, "z"], coronal: [ny - 1, "y"], sagittal: [nx - 1, "x"] };
  for (const [name, [max, axis]] of Object.entries(config)) {
    views[name].slider.max = max;
    views[name].slider.value = state.position[axis];
  }
}

function applyAutoWindow() {
  state.windowCenter = state.autoWindow.center;
  state.windowWidth = state.autoWindow.width;
  elements["window-center"].value = Number(state.windowCenter.toPrecision(7));
  elements["window-width"].value = Number(state.windowWidth.toPrecision(7));
}

function colorFor(normalized) {
  const t = Math.max(0, Math.min(1, normalized));
  if (elements.colormap.value === "hot") {
    return [Math.min(255, 765 * t), Math.min(255, Math.max(0, 765 * t - 255)), Math.min(255, Math.max(0, 765 * t - 510))];
  }
  if (elements.colormap.value === "viridis") {
    const stops = [[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]];
    const p = t * (stops.length - 1); const i = Math.min(stops.length - 2, Math.floor(p)); const f = p - i;
    return stops[i].map((v, channel) => v + (stops[i + 1][channel] - v) * f);
  }
  const gray = t * 255;
  return [gray, gray, gray];
}

function drawSlice(name) {
  const volume = state.volume;
  if (!volume) return;
  const [nx, ny, nz] = volume.dimensions;
  let width; let height; let valueAt; let crossX; let crossY;
  if (name === "axial") {
    width = nx; height = ny; crossX = state.position.x; crossY = ny - 1 - state.position.y;
    valueAt = (u, v) => scaledValue(volume, u + (ny - 1 - v) * nx + state.position.z * nx * ny);
  } else if (name === "coronal") {
    width = nx; height = nz; crossX = state.position.x; crossY = nz - 1 - state.position.z;
    valueAt = (u, v) => scaledValue(volume, u + state.position.y * nx + (nz - 1 - v) * nx * ny);
  } else {
    width = ny; height = nz; crossX = state.position.y; crossY = nz - 1 - state.position.z;
    valueAt = (u, v) => scaledValue(volume, state.position.x + u * nx + (nz - 1 - v) * nx * ny);
  }

  const canvas = views[name].canvas;
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  const pixels = context.createImageData(width, height);
  const low = state.windowCenter - state.windowWidth / 2;
  for (let v = 0; v < height; v += 1) {
    for (let u = 0; u < width; u += 1) {
      const normalized = (valueAt(u, v) - low) / state.windowWidth;
      const color = colorFor(normalized);
      const offset = (v * width + u) * 4;
      pixels.data[offset] = color[0]; pixels.data[offset + 1] = color[1];
      pixels.data[offset + 2] = color[2]; pixels.data[offset + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  context.strokeStyle = "rgba(87, 184, 255, .8)";
  context.lineWidth = 1;
  context.beginPath(); context.moveTo(crossX + .5, 0); context.lineTo(crossX + .5, height); context.stroke();
  context.beginPath(); context.moveTo(0, crossY + .5); context.lineTo(width, crossY + .5); context.stroke();
}

function drawAllViews() {
  if (!state.volume) return;
  for (const name of Object.keys(views)) drawSlice(name);
  const { x, y, z } = state.position;
  views.axial.slider.value = z; views.coronal.slider.value = y; views.sagittal.slider.value = x;
  views.axial.output.textContent = `${z + 1} / ${state.volume.dimensions[2]}`;
  views.coronal.output.textContent = `${y + 1} / ${state.volume.dimensions[1]}`;
  views.sagittal.output.textContent = `${x + 1} / ${state.volume.dimensions[0]}`;
  const index = x + y * state.volume.dimensions[0] + z * state.volume.dimensions[0] * state.volume.dimensions[1];
  elements["voxel-readout"].textContent = `体素 (${x}, ${y}, ${z})：${scaledValue(state.volume, index).toPrecision(6)}`;
}

function resetViews() {
  for (const view of Object.values(views)) {
    view.scale = 1; view.offsetX = 0; view.offsetY = 0;
    applyViewTransform(view);
  }
}

function applyViewTransform(view) {
  view.canvas.style.transform = `translate(${view.offsetX}px, ${view.offsetY}px) scale(${view.scale})`;
}

for (const [name, view] of Object.entries(views)) {
  view.slider.addEventListener("input", () => {
    const axis = name === "axial" ? "z" : name === "coronal" ? "y" : "x";
    state.position[axis] = Number(view.slider.value);
    drawAllViews();
  });
  view.stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    view.scale = Math.max(1, Math.min(8, view.scale * (event.deltaY < 0 ? 1.15 : 0.87)));
    applyViewTransform(view);
  }, { passive: false });
  let drag = null;
  view.stage.addEventListener("pointerdown", (event) => {
    drag = { x: event.clientX, y: event.clientY, ox: view.offsetX, oy: view.offsetY, moved: false };
    view.stage.setPointerCapture(event.pointerId);
  });
  view.stage.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x; const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (view.scale > 1) { view.offsetX = drag.ox + dx; view.offsetY = drag.oy + dy; applyViewTransform(view); }
  });
  view.stage.addEventListener("pointerup", (event) => {
    if (drag && !drag.moved && state.volume) {
      const rect = view.canvas.getBoundingClientRect();
      const u = Math.max(0, Math.min(0.999999, (event.clientX - rect.left) / rect.width));
      const v = Math.max(0, Math.min(0.999999, (event.clientY - rect.top) / rect.height));
      const [nx, ny, nz] = state.volume.dimensions;
      if (name === "axial") { state.position.x = Math.floor(u * nx); state.position.y = ny - 1 - Math.floor(v * ny); }
      else if (name === "coronal") { state.position.x = Math.floor(u * nx); state.position.z = nz - 1 - Math.floor(v * nz); }
      else { state.position.y = Math.floor(u * ny); state.position.z = nz - 1 - Math.floor(v * nz); }
      drawAllViews();
    }
    drag = null;
  });
}

elements["case-select"].addEventListener("change", () => loadCase(elements["case-select"].value).catch(showError));
elements["modality-select"].addEventListener("change", () => loadVolume(elements["modality-select"].value).catch(showError));
elements["window-center"].addEventListener("change", () => { state.windowCenter = Number(elements["window-center"].value); drawAllViews(); });
elements["window-width"].addEventListener("change", () => { state.windowWidth = Math.max(Number.EPSILON, Number(elements["window-width"].value)); drawAllViews(); });
elements["auto-window"].addEventListener("click", () => { applyAutoWindow(); drawAllViews(); });
elements.colormap.addEventListener("change", () => {
  drawAllViews();
  updateVolumeTransferFunctions();
});
elements["reset-view"].addEventListener("click", resetViews);
elements["volume-threshold"].addEventListener("input", updateVolumeTransferFunctions);
elements["volume-opacity"].addEventListener("input", updateVolumeTransferFunctions);
elements["reset-volume"].addEventListener("click", resetVolumeCamera);

function showError(error) {
  if (error?.name === "AbortError") return;
  console.error(error);
  setStatus(error.message || "发生错误。", true);
  elements["empty-state"].textContent = error.message || "影像加载失败。";
  elements["empty-state"].classList.remove("hidden");
  elements["view-grid"].classList.add("hidden");
}

async function initialize() {
  const response = await fetch("/api/cases");
  if (!response.ok) throw new Error("病例索引读取失败。");
  const payload = await response.json();
  state.cases = payload.cases;
  elements["case-select"].replaceChildren();
  for (const record of state.cases) {
    const suffix = record.missingOptionalModalities.includes("ADC") ? " · 无 ADC" : "";
    elements["case-select"].add(new Option(`${record.id}${suffix}`, record.id));
  }
  setStatus(`已索引 ${payload.summary.caseCount} 个病例`);
  await loadCase(state.cases[0].id);
}

initialize().catch(showError);
