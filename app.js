import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.worker.min.mjs";

const state = {
  pdf: null,
  page: 1,
  pageCount: 0,
  viewportScale: 1.4,
  viewZoom: 1,
  activeTool: "rect",
  scaleMode: "dimension",
  settingScale: false,
  scaleMPerPx: 0,
  scaleLabel: "",
  scalePoints: [],
  detectedScales: [],
  drawing: false,
  panning: false,
  temporaryPan: false,
  panStart: null,
  start: null,
  preview: null,
  polyPoints: [],
  selectedShape: null,
  textLines: [],
  scheduleRules: {},
  shapes: []
};

const pdfCanvas = document.getElementById("pdfCanvas");
const markupCanvas = document.getElementById("markupCanvas");
const pdfCtx = pdfCanvas.getContext("2d");
const markCtx = markupCanvas.getContext("2d");
const form = document.getElementById("elementForm");

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  renderBoq();
});

function bindEvents() {
  document.getElementById("pdfInput").addEventListener("change", loadPdfFile);
  document.querySelectorAll(".tool").forEach((button) => {
    button.addEventListener("click", () => setTool(button.dataset.tool));
  });
  document.querySelectorAll(".scale-mode").forEach((button) => {
    button.addEventListener("click", () => setScaleMode(button.dataset.scaleMode));
  });
  document.getElementById("scaleTool").addEventListener("click", startScaleTool);
  document.getElementById("applyRatioScale").addEventListener("click", applyRatioScale);
  document.getElementById("applyDetectedScale").addEventListener("click", applySelectedDetectedScale);
  document.getElementById("finishPolyBtn").addEventListener("click", finishPolygon);
  document.getElementById("undoBtn").addEventListener("click", undoPoint);
  document.getElementById("zoomOutBtn").addEventListener("click", () => setViewZoom(state.viewZoom / 1.2));
  document.getElementById("zoomInBtn").addEventListener("click", () => setViewZoom(state.viewZoom * 1.2));
  document.getElementById("zoomResetBtn").addEventListener("click", () => setViewZoom(1));
  document.getElementById("prevPage").addEventListener("click", () => goPage(-1));
  document.getElementById("nextPage").addEventListener("click", () => goPage(1));
  document.getElementById("clearBtn").addEventListener("click", clearAll);
  document.getElementById("exportCsvBtn").addEventListener("click", exportCsv);
  document.getElementById("printQuoteBtn").addEventListener("click", () => window.print());
  ["marketSteelRate", "marketConcreteRate", "marketFormworkRate", "profitMargin"].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => {
      form.steelRate.value = document.getElementById("marketSteelRate").value;
      renderBoq();
    });
  });
  markupCanvas.addEventListener("mousedown", pointerDown);
  markupCanvas.addEventListener("wheel", zoomWithWheel, { passive: false });
  markupCanvas.addEventListener("auxclick", stopMiddleClickDefault);
  window.addEventListener("mousemove", pointerMove);
  window.addEventListener("mouseup", pointerUp);
  markupCanvas.addEventListener("touchstart", touchAsMouse, { passive: false });
  markupCanvas.addEventListener("touchmove", touchAsMouse, { passive: false });
  markupCanvas.addEventListener("touchend", touchAsMouse, { passive: false });
  document.addEventListener("keydown", handleKeyboard);
  form.addEventListener("input", showMissingParameters);
  form.addEventListener("submit", saveSelectedElement);
  document.getElementById("quoteDate").value = new Date().toISOString().slice(0, 10);
  form.steelRate.value = document.getElementById("marketSteelRate").value;
}

async function loadPdfFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const buffer = await file.arrayBuffer();
  state.pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  state.page = 1;
  state.pageCount = state.pdf.numPages;
  document.getElementById("dropZone").classList.add("hidden");
  document.getElementById("canvasWrap").classList.remove("hidden");
  await renderPage();
  await extractTextHints();
}

async function renderPage() {
  if (!state.pdf) return;
  const page = await state.pdf.getPage(state.page);
  const viewport = page.getViewport({ scale: state.viewportScale });
  pdfCanvas.width = viewport.width;
  pdfCanvas.height = viewport.height;
  markupCanvas.width = viewport.width;
  markupCanvas.height = viewport.height;
  await page.render({ canvasContext: pdfCtx, viewport }).promise;
  document.getElementById("pageInfo").textContent = `${state.page} / ${state.pageCount}`;
  applyCanvasZoom();
  drawMarkup();
}

async function extractTextHints() {
  const hints = [];
  const allLines = [];
  const scaleBarCandidates = [];
  const words = /(concrete|slab|footing|pad|wall|beam|column|thick|reinforced|rc|blinding)/i;
  for (let pageNumber = 1; pageNumber <= state.pageCount; pageNumber++) {
    const page = await state.pdf.getPage(pageNumber);
    const text = await page.getTextContent();
    scaleBarCandidates.push(...detectScaleBarCandidates(text.items, pageNumber));
    const strings = text.items.map((item) => item.str).join(" ");
    strings.split(/(?<=[.;])\s+/).forEach((line) => {
      allLines.push({ page: pageNumber, text: line });
      if (words.test(line)) hints.push({ page: pageNumber, text: line.slice(0, 220) });
    });
  }
  state.textLines = allLines;
  state.scheduleRules = parseReinforcementSchedules(allLines);
  state.detectedScales = [...detectScaleCandidates(allLines), ...scaleBarCandidates]
    .sort((a, b) => b.score - a.score || a.page - b.page || (a.ratio || 0) - (b.ratio || 0));
  renderDetectedScales();
  applyPreferredDetectedScale();
  const wrapper = document.getElementById("textHints");
  wrapper.innerHTML = hints.length
    ? hints.slice(0, 30).map((hint) => `<div class="hint"><b>Page ${hint.page}:</b> ${escapeHtml(hint.text)}</div>`).join("")
    : `<div class="hint">No selectable concrete text found. Mark up the plan manually.</div>`;
}

function setTool(tool) {
  state.activeTool = tool;
  state.settingScale = false;
  state.preview = null;
  document.querySelectorAll(".tool").forEach((button) => button.classList.toggle("active", button.dataset.tool === tool));
  markupCanvas.classList.toggle("pan-mode", tool === "pan");
  drawMarkup();
}

function setScaleMode(mode) {
  state.scaleMode = mode;
  state.settingScale = false;
  state.scalePoints = [];
  document.querySelectorAll(".scale-mode").forEach((button) => button.classList.toggle("active", button.dataset.scaleMode === mode));
  document.getElementById("dimensionScaleFields").classList.toggle("hidden", mode !== "dimension");
  document.getElementById("ratioScaleFields").classList.toggle("hidden", mode !== "ratio");
  document.getElementById("scaleStatus").textContent = state.scaleLabel || "No scale set.";
  drawMarkup();
}

function startScaleTool() {
  state.scaleMode = "dimension";
  state.settingScale = true;
  state.scalePoints = [];
  const label = gridScaleLabel();
  document.getElementById("scaleStatus").textContent = `Click the two ends of ${label}.`;
}

function pointerDown(event) {
  if (event.button === 1 || state.activeTool === "pan") {
    event.preventDefault();
    startPanning(event, event.button === 1);
    return;
  }

  const point = canvasPoint(event);
  if (state.activeTool === "erase") {
    eraseShapeAt(point);
    return;
  }

  if (state.settingScale) {
    state.scalePoints.push(point);
    if (state.scalePoints.length === 2) finishScale();
    drawMarkup();
    return;
  }

  if (state.activeTool === "poly") {
    state.polyPoints.push(point);
    drawMarkup();
    return;
  }

  state.drawing = true;
  state.start = point;
  state.preview = null;
}

function handleKeyboard(event) {
  const isTyping = ["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName);
  if (isTyping) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    undoMarkup();
  }
}

function pointerMove(event) {
  if (state.panning && state.panStart) {
    const wrap = document.getElementById("canvasWrap");
    wrap.scrollLeft += state.panStart.x - event.clientX;
    wrap.scrollTop += state.panStart.y - event.clientY;
    state.panStart.x = event.clientX;
    state.panStart.y = event.clientY;
    return;
  }
  if (!state.drawing || !state.start) return;
  state.preview = canvasPoint(event);
  drawMarkup();
}

function pointerUp(event) {
  if (state.panning) {
    state.panning = false;
    state.temporaryPan = false;
    state.panStart = null;
    setPanVisual(false);
    return;
  }
  if (!state.drawing || !state.start) return;
  const end = canvasPoint(event);
  const shape = state.activeTool === "line"
    ? { kind: "line", page: state.page, points: [state.start, end] }
    : { kind: "rect", page: state.page, points: [state.start, end] };
  state.shapes.push(shape);
  selectShape(shape);
  state.drawing = false;
  state.start = null;
  state.preview = null;
  drawMarkup();
}

function startPanning(event, temporary) {
  state.panning = true;
  state.temporaryPan = temporary;
  state.panStart = {
    x: event.clientX,
    y: event.clientY
  };
  setPanVisual(true);
}

function setPanVisual(active) {
  markupCanvas.classList.toggle("panning", active);
  document.getElementById("canvasWrap").classList.toggle("panning", active);
  document.body.classList.toggle("pan-active", active);
  document.getElementById("panIndicator").classList.toggle("hidden", !active);
}

function setViewZoom(nextZoom, anchor) {
  const wrap = document.getElementById("canvasWrap");
  const oldZoom = state.viewZoom;
  state.viewZoom = Math.max(0.35, Math.min(4, nextZoom));
  applyCanvasZoom();
  if (anchor && oldZoom !== state.viewZoom) {
    const ratio = state.viewZoom / oldZoom;
    wrap.scrollLeft = (wrap.scrollLeft + anchor.x) * ratio - anchor.x;
    wrap.scrollTop = (wrap.scrollTop + anchor.y) * ratio - anchor.y;
  }
}

function applyCanvasZoom() {
  const width = `${pdfCanvas.width * state.viewZoom}px`;
  const height = `${pdfCanvas.height * state.viewZoom}px`;
  [pdfCanvas, markupCanvas].forEach((canvas) => {
    canvas.style.width = width;
    canvas.style.height = height;
  });
  document.getElementById("zoomLevel").textContent = `${Math.round(state.viewZoom * 100)}%`;
}

function zoomWithWheel(event) {
  event.preventDefault();
  const wrap = document.getElementById("canvasWrap");
  const rect = wrap.getBoundingClientRect();
  const anchor = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  setViewZoom(state.viewZoom * factor, anchor);
}

function stopMiddleClickDefault(event) {
  if (event.button === 1) event.preventDefault();
}

function touchAsMouse(event) {
  event.preventDefault();
  const touch = event.changedTouches[0];
  if (!touch) return;
  const type = event.type === "touchstart" ? "mousedown" : event.type === "touchmove" ? "mousemove" : "mouseup";
  markupCanvas.dispatchEvent(new MouseEvent(type, {
    clientX: touch.clientX,
    clientY: touch.clientY,
    bubbles: true
  }));
}

function finishScale() {
  const known = numberValue(document.getElementById("knownDistance").value);
  if (!known) {
    alert("Enter the grid dimension first.");
    state.scalePoints = [];
    return;
  }
  const unit = document.getElementById("scaleUnit").value;
  const knownM = unit === "mm" ? known / 1000 : known;
  const px = distance(state.scalePoints[0], state.scalePoints[1]);
  state.scaleMPerPx = knownM / px;
  const gridLabel = gridScaleLabel();
  state.scaleLabel = `Scale set from ${gridLabel} = ${fmtKnown(knownM)} m: 1 px = ${state.scaleMPerPx.toFixed(5)} m`;
  state.settingScale = false;
  document.getElementById("scaleStatus").textContent = state.scaleLabel;
}

function applyRatioScale() {
  const ratio = parsePlanScale(document.getElementById("scaleRatio").value);
  if (!ratio) {
    alert("Enter a plan scale like 1:100 or 1/100.");
    return;
  }
  setScaleFromRatio(ratio, `printed ratio 1:${ratio}`);
  showMissingParameters();
  drawMarkup();
}

function applySelectedDetectedScale() {
  const select = document.getElementById("detectedScaleSelect");
  const candidate = state.detectedScales[Number(select.value)];
  if (!candidate) return;
  applyScaleCandidate(candidate);
  showMissingParameters();
  drawMarkup();
}

function applyScaleCandidate(candidate) {
  if (candidate.mPerPx) {
    setScaleFromMetresPerPixel(candidate.mPerPx, candidate.label);
    return;
  }
  setScaleFromRatio(candidate.ratio, candidate.label);
}

function setScaleFromRatio(ratio, sourceLabel) {
  const pageMmPerCanvasPx = 25.4 / 72 / state.viewportScale;
  setScaleFromMetresPerPixel((pageMmPerCanvasPx * ratio) / 1000, sourceLabel);
}

function setScaleFromMetresPerPixel(mPerPx, sourceLabel) {
  state.scaleMPerPx = mPerPx;
  state.scalePoints = [];
  state.settingScale = false;
  state.scaleLabel = `Scale set from ${sourceLabel}: 1 px = ${state.scaleMPerPx.toFixed(5)} m`;
  document.getElementById("scaleStatus").textContent = state.scaleLabel;
}

function finishPolygon() {
  if (state.polyPoints.length < 3) {
    alert("Polygon needs at least 3 points.");
    return;
  }
  const shape = { kind: "poly", page: state.page, points: [...state.polyPoints] };
  state.shapes.push(shape);
  state.polyPoints = [];
  selectShape(shape);
  drawMarkup();
}

function undoPoint() {
  state.polyPoints.pop();
  drawMarkup();
}

function undoMarkup() {
  if (state.polyPoints.length) {
    state.polyPoints.pop();
  } else if (state.scalePoints.length && state.settingScale) {
    state.scalePoints.pop();
  } else {
    const currentPageShapes = state.shapes.filter((shape) => shape.page === state.page);
    const last = currentPageShapes[currentPageShapes.length - 1];
    if (last) {
      state.shapes = state.shapes.filter((shape) => shape !== last);
      if (state.selectedShape === last) state.selectedShape = null;
      renderBoq();
    }
  }
  drawMarkup();
}

function eraseShapeAt(point) {
  const target = findShapeAtPoint(point);
  if (!target) return;
  state.shapes = state.shapes.filter((shape) => shape !== target);
  if (state.selectedShape === target) state.selectedShape = null;
  renderBoq();
  drawMarkup();
}

function findShapeAtPoint(point) {
  return [...state.shapes]
    .reverse()
    .find((shape) => shape.page === state.page && shapeContainsPoint(shape, point));
}

function shapeContainsPoint(shape, point) {
  const tolerance = 8 / state.viewZoom;
  if (shape.kind === "line") {
    return pointToSegmentDistance(point, shape.points[0], shape.points[1]) <= tolerance;
  }
  if (shape.kind === "rect") {
    const [a, b] = shape.points;
    const minX = Math.min(a.x, b.x) - tolerance;
    const maxX = Math.max(a.x, b.x) + tolerance;
    const minY = Math.min(a.y, b.y) - tolerance;
    const maxY = Math.max(a.y, b.y) + tolerance;
    return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
  }
  return pointInPolygon(point, shape.points) || shape.points.some((vertex, index) => {
    const next = shape.points[(index + 1) % shape.points.length];
    return pointToSegmentDistance(point, vertex, next) <= tolerance;
  });
}

function pointToSegmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (!dx && !dy) return distance(point, a);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function selectShape(shape) {
  state.selectedShape = shape;
  form.name.value = `Page ${shape.page} concrete ${state.shapes.length}`;
  form.type.value = shape.kind === "line" ? "wall" : "slab";
  form.shapeGeometry.value = shape.kind === "poly" ? "irregular" : "regular";
  showMissingParameters();
}

function saveSelectedElement(event) {
  event.preventDefault();
  if (!state.selectedShape) {
    alert("Draw or select an element first.");
    return;
  }
  if (!state.scaleMPerPx) {
    alert("Set the plan scale first.");
    return;
  }
  const result = calculateShape(state.selectedShape, formValues());
  if (result.missing.length) {
    showMissingParameters();
    return;
  }
  Object.assign(state.selectedShape, { saved: true, boq: result });
  state.selectedShape = null;
  form.reset();
  form.waste.value = 5;
  form.elementQuantity.value = "";
  renderBoq();
  drawMarkup();
}

function calculateShape(shape, values) {
  const measured = applyMeasureInputs(measureShape(shape), values);
  const type = values.type;
  const missing = [];
  const thicknessM = values.thicknessMm / 1000;
  let area = measured.area;
  let volume = 0;
  let formwork = 0;

  if (type === "slab") {
    if (!values.thicknessMm) missing.push("thickness mm");
    volume = area * thicknessM;
    formwork = measured.perimeter * thicknessM;
  } else if (type === "isolatedFooting" || type === "padFooting") {
    if (!values.height) missing.push("height / depth");
    volume = area * values.height;
    formwork = measured.perimeter * values.height;
  } else if (type === "wall" || type === "beam") {
    if (!values.width) missing.push("width");
    if (!values.height) missing.push("height");
    area = measured.length * values.height;
    volume = measured.length * values.width * values.height;
    formwork = measured.length * values.height * 2;
  } else if (type === "column") {
    if (!values.height) missing.push("height");
    volume = area * values.height;
    formwork = measured.perimeter * values.height;
  }

  const wasteFactor = 1 + values.waste / 100;
  const reinforcement = calculateReinforcement(type, values, measured, area, volume, wasteFactor);
  const dowels = calculateDowels(values, measured, reinforcement.weightKg);
  const sawCut = calculateSawCut(values, measured);
  const tools = calculateTools(values, reinforcement.weightKg);
  const manpower = calculateManpower(volume * wasteFactor, reinforcement.weightKg, sawCut.workerDays, values);
  return {
    ...values,
    page: shape.page,
    measured,
    area,
    volume,
    formwork,
    volumeWithWaste: volume * wasteFactor,
    formworkWithWaste: formwork * wasteFactor,
    reinforcement,
    dowels,
    sawCut,
    tools,
    manpower,
    missing
  };
}

function applyMeasureInputs(measured, values) {
  const factor = values.elementQuantity || 1;
  const manual = values.manualMeasure || 0;
  const result = { ...measured, quantity: factor, manualMeasure: manual, manualMeasureUnit: values.manualMeasureUnit };
  if (manual && values.manualMeasureUnit === "m2") {
    result.area = manual * factor;
    result.perimeter = measured.perimeter * factor;
    result.length = measured.length * factor;
    return result;
  }
  if (manual && values.manualMeasureUnit === "lm") {
    result.area = 0;
    result.perimeter = manual * factor;
    result.length = manual * factor;
    return result;
  }
  return {
    ...result,
    area: measured.area * factor,
    perimeter: measured.perimeter * factor,
    length: measured.length * factor
  };
}

function measureShape(shape) {
  if (!state.scaleMPerPx) return { area: 0, perimeter: 0, length: 0 };
  if (shape.kind === "line") {
    return { area: 0, perimeter: 0, length: distance(shape.points[0], shape.points[1]) * state.scaleMPerPx };
  }
  if (shape.kind === "rect") {
    const [a, b] = shape.points;
    const width = Math.abs(b.x - a.x) * state.scaleMPerPx;
    const height = Math.abs(b.y - a.y) * state.scaleMPerPx;
    return { area: width * height, perimeter: 2 * (width + height), length: Math.max(width, height) };
  }
  const scaled = shape.points.map((point) => ({ x: point.x * state.scaleMPerPx, y: point.y * state.scaleMPerPx }));
  return { area: polygonArea(scaled), perimeter: polygonPerimeter(scaled), length: polygonPerimeter(scaled) };
}

function calculateReinforcement(type, values, measured, area, volume, wasteFactor) {
  const rule = values.reoSource !== "minimum" ? state.scheduleRules[values.tag] : null;
  const steelRate = values.steelRate || 0;
  let weightKg = 0;
  let description = "Minimum assumption";

  if (rule && values.reoSource !== "manual") {
    if (rule.meshKgPerM2) {
      weightKg = area * rule.meshKgPerM2;
      description = `${values.tag}: ${rule.description}`;
    } else if (rule.barDiameter && rule.spacing) {
      weightKg = areaRebarWeight(area, rule.barDiameter, rule.spacing, rule.layers || values.reoLayers || 1, values.reoDirection);
      description = `${values.tag}: ${rule.description}`;
    }
  }

  if (!weightKg && values.reoSource === "manual") {
    if (values.meshKgPerM2) {
      weightKg = area * values.meshKgPerM2;
      description = `Manual mesh ${values.meshKgPerM2} kg/m2`;
    } else if (values.barDiameter && values.barSpacing) {
      weightKg = areaRebarWeight(area, values.barDiameter, values.barSpacing, values.reoLayers || 1, values.reoDirection);
      description = `Manual ${reoDirectionLabel(values.reoDirection)} N${values.barDiameter} @ ${values.barSpacing} mm, ${values.reoLayers || 1} layer(s)`;
    }
  }

  if (!weightKg) {
    if (type === "slab" && values.barDiameter && values.barSpacing) {
      weightKg = areaRebarWeight(area, values.barDiameter, values.barSpacing, values.reoLayers || 1, values.reoDirection);
      description = `Minimum slab assumption: ${reoDirectionLabel(values.reoDirection)} N${values.barDiameter} @ ${values.barSpacing} mm, ${values.reoLayers || 1} layer(s)`;
    } else {
      weightKg = volume * (values.reoKgPerM3 || 80);
      description = `Minimum allowance: ${values.reoKgPerM3 || 80} kg/m3`;
    }
  }

  weightKg *= wasteFactor;
  return {
    weightKg,
    cost: weightKg * steelRate,
    description,
    matchedSchedule: Boolean(rule)
  };
}

function calculateDowels(values, measured, reoKg) {
  if (values.includeDowels !== "yes") {
    return { count: 0, barWeightKg: 0, epoxyCost: 0, steelCost: 0, totalCost: 0, description: "Not included" };
  }
  const spacingM = values.dowelSpacingMm / 1000;
  const count = spacingM ? Math.ceil((measured.perimeter || measured.length || 0) / spacingM) : 0;
  const lengthM = values.dowelLengthMm / 1000;
  const barWeightKg = count * lengthM * barKgPerM(values.dowelDiameter);
  const epoxyCost = count * values.epoxyRatePerDowel;
  const steelCost = barWeightKg * values.steelRate;
  return {
    count,
    barWeightKg,
    epoxyCost,
    steelCost,
    totalCost: epoxyCost + steelCost,
    description: `${count} N${values.dowelDiameter} dowels, ${values.dowelLengthMm} mm long, ${values.dowelEmbedmentMm} mm embedment, ${values.dowelSpacingMm} mm c/c, ${values.epoxyBrand}`
  };
}

function calculateSawCut(values, measured) {
  if (values.sawCutRequired !== "yes") {
    return { lengthLm: 0, cost: 0, workerDays: 0, durationDays: 0, description: "Not required" };
  }
  const lengthLm = values.sawCutLm || measured.perimeter || measured.length || 0;
  const workerDays = values.sawCutProdLmPerDay ? lengthLm / values.sawCutProdLmPerDay : 0;
  const crew = Math.max(1, Math.ceil(values.sawCutCrew || 1));
  const durationDays = workerDays / crew;
  return {
    lengthLm,
    cost: lengthLm * values.sawCutRate,
    workerDays,
    durationDays,
    description: `${fmt(lengthLm)} lm @ ${money(values.sawCutRate)}/lm, ${fmt(workerDays)} worker-days, ${crew} saw-cut crew`
  };
}

function calculateTools(values, reoKg) {
  const tieWireKg = values.tieWireKg || reoKg * 0.015;
  const tieWireCost = tieWireKg * values.tieWireRate;
  const smallToolsCost = values.smallToolsAllowance;
  const equipmentDamageCost = values.equipmentDamageAllowance;
  return {
    tieWireKg,
    tieWireCost,
    smallToolsCost,
    equipmentDamageCost,
    totalCost: tieWireCost + smallToolsCost + equipmentDamageCost,
    description: `${fmt(tieWireKg)} kg tie wire, ${money(smallToolsCost)} tools, ${money(equipmentDamageCost)} equipment wear`
  };
}

function calculateManpower(volumeWithWaste, reoKg, sawCutWorkerDays, values) {
  const concreteWorkerDays = values.prodM3PerWorkerDay ? volumeWithWaste / values.prodM3PerWorkerDay : 0;
  const reoWorkerDays = values.prodKgPerWorkerDay ? reoKg / values.prodKgPerWorkerDay : 0;
  const workerDays = Math.max(concreteWorkerDays + reoWorkerDays + sawCutWorkerDays, 0.25);
  const crew = Math.max(1, Math.ceil(values.minCrew || 1));
  return {
    crew,
    workerDays,
    durationDays: Math.max(0.5, workerDays / crew),
    hours: workerDays * (values.hoursPerDay || 8)
  };
}

function parseReinforcementSchedules(lines) {
  const rules = {};
  lines.forEach(({ text }) => {
    const clean = text.replace(/\s+/g, " ").trim().toUpperCase();
    const tag = clean.match(/\b([A-Z]{1,3}\d{1,3})\b/)?.[1];
    if (!tag) return;

    const mesh = clean.match(/\bSL\s?(\d{2,3})\b/);
    const bars = clean.match(/\b(?:N|Y|R)?(\d{2,3})\s*[-@]\s*(\d{2,4})\b/);
    const layers = /DOUBLE|2\s*LAY|T\/B|TOP\s*(?:AND|&)\s*BOTTOM/i.test(clean) ? 2 : 1;

    if (mesh) {
      rules[tag] = {
        meshKgPerM2: meshWeight(`SL${mesh[1]}`),
        layers,
        description: `SL${mesh[1]} mesh${layers > 1 ? ", double layer" : ""}`
      };
    } else if (bars) {
      rules[tag] = {
        barDiameter: Number(bars[1]),
        spacing: Number(bars[2]),
        layers,
        description: `N${bars[1]} @ ${bars[2]} mm${layers > 1 ? ", double layer" : ""}`
      };
    }
  });
  return rules;
}

function detectScaleCandidates(lines) {
  const candidates = [];
  const seen = new Set();
  lines.forEach(({ page, text }) => {
    const clean = text.replace(/\s+/g, " ").trim();
    const ratioMatches = [...clean.matchAll(/\b1\s*[:/]\s*(\d+(?:\.\d+)?)\b/gi)];
    ratioMatches.forEach((match) => {
      const ratio = Number.parseFloat(match[1]);
      if (!ratio) return;
      const localText = clean.slice(Math.max(0, match.index - 35), match.index + match[0].length + 25);
      const kind = scaleContextForRatio(clean, match.index, match[0].length);
      const key = `${page}-${ratio}-${kind}-${clean.slice(0, 80)}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({
        page,
        ratio,
        kind,
        text: clean.slice(0, 180),
        label: `${kind} scale 1:${ratio} on page ${page}`,
        score: scaleScore(localText, kind)
      });
    });

  });
  return candidates
    .filter((candidate) => candidate.ratio)
    .sort((a, b) => b.score - a.score || a.page - b.page || a.ratio - b.ratio);
}

function detectScaleBarCandidates(items, page) {
  const labels = items
    .map((item) => {
      const text = String(item.str || "").trim().toLowerCase();
      const match = text.match(/^(\d+(?:\.\d+)?)\s*(m|metres?|meters?|mm|millimetres?|millimeters?)?$/);
      if (!match) return null;
      return {
        value: Number.parseFloat(match[1]),
        unit: match[2] || "",
        x: item.transform?.[4] || 0,
        y: item.transform?.[5] || 0
      };
    })
    .filter(Boolean);

  const candidates = [];
  labels.forEach((start) => {
    if (start.value !== 0) return;
    labels.forEach((end) => {
      if (end.value <= 0 || Math.abs(start.y - end.y) > 5) return;
      const dxPdfPoints = Math.abs(end.x - start.x);
      if (dxPdfPoints < 20) return;
      const unit = end.unit || start.unit;
      if (!unit) return;
      const knownM = /mm|millimet/.test(unit) ? end.value / 1000 : end.value;
      const dxCanvasPx = dxPdfPoints * state.viewportScale;
      candidates.push({
        page,
        kind: "line scale",
        mPerPx: knownM / dxCanvasPx,
        text: `0 to ${end.value}${unit}`,
        label: `detected line scale 0-${end.value}${unit} on page ${page}`,
        score: 85
      });
    });
  });

  return candidates.sort((a, b) => b.score - a.score).slice(0, 3);
}

function scaleContext(text) {
  if (/\b(plan|floor|site|ground|layout|general arrangement|ga)\b/i.test(text)) return "plan";
  if (/\b(section|sections|elevation|elevations|detail|details|sec\.?)\b/i.test(text)) return "section";
  return "drawing";
}

function scaleContextForRatio(text, ratioIndex, ratioLength) {
  const before = text.slice(Math.max(0, ratioIndex - 45), ratioIndex);
  const after = text.slice(ratioIndex + ratioLength, ratioIndex + ratioLength + 24);
  const planBefore = lastKeywordIndex(before, /\b(plan|floor|site|ground|layout|general arrangement|ga)\b/gi);
  const sectionBefore = lastKeywordIndex(before, /\b(section|sections|elevation|elevations|detail|details|sec\.?)\b/gi);

  if (planBefore >= 0 || sectionBefore >= 0) {
    return planBefore > sectionBefore ? "plan" : "section";
  }
  return scaleContext(after);
}

function lastKeywordIndex(text, pattern) {
  let last = -1;
  for (const match of text.matchAll(pattern)) last = match.index;
  return last;
}

function scaleScore(text, kind) {
  let score = kind === "plan" ? 100 : kind === "drawing" ? 60 : 20;
  if (/\bscale\b/i.test(text)) score += 12;
  if (/\bnot\s+to\s+scale|nts\b/i.test(text)) score -= 100;
  if (/\bsection|elevation|detail\b/i.test(text) && /\bplan\b/i.test(text)) score += 35;
  if (/\bsection|elevation|detail\b/i.test(text) && !/\bplan\b/i.test(text)) score -= 15;
  return score;
}

function renderDetectedScales() {
  const box = document.getElementById("detectedScaleBox");
  const select = document.getElementById("detectedScaleSelect");
  if (!state.detectedScales.length) {
    box.classList.add("hidden");
    select.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");
  select.innerHTML = state.detectedScales.map((candidate, index) => {
    const note = candidate.kind === "section" ? "section/detail, use separately" : candidate.kind;
    const scaleText = candidate.ratio ? `1:${candidate.ratio}` : candidate.text;
    return `<option value="${index}">Page ${candidate.page}: ${scaleText} (${note})</option>`;
  }).join("");
}

function applyPreferredDetectedScale() {
  const preferred = state.detectedScales.find((candidate) => candidate.kind === "plan")
    || state.detectedScales.find((candidate) => candidate.kind === "line scale")
    || state.detectedScales.find((candidate) => candidate.kind === "drawing");
  if (!preferred) {
    if (state.detectedScales.some((candidate) => candidate.kind === "section")) {
      document.getElementById("scaleStatus").textContent = "Section/detail scale detected only. Select it if you are measuring that section.";
    }
    return;
  }
  applyScaleCandidate(preferred);
}

function meshWeight(mesh) {
  return {
    SL62: 2.3,
    SL72: 3.1,
    SL82: 4.1,
    SL92: 5.2,
    SL102: 6.4
  }[mesh] || 4.1;
}

function areaRebarWeight(area, diameterMm, spacingMm, layers, direction = "twoWay") {
  const spacingM = spacingMm / 1000;
  if (!area || !spacingM || !diameterMm) return 0;
  const directionFactor = direction === "oneWay" ? 1 : 2;
  return area * (directionFactor / spacingM) * barKgPerM(diameterMm) * (layers || 1);
}

function barKgPerM(diameterMm) {
  return (diameterMm * diameterMm) / 162;
}

function reoDirectionLabel(direction) {
  return direction === "oneWay" ? "one-way" : "two-way";
}

function showMissingParameters() {
  if (!state.selectedShape) return;
  const result = calculateShape(state.selectedShape, formValues());
  const box = document.getElementById("missingBox");
  if (!state.scaleMPerPx) {
    box.classList.remove("hidden");
    box.textContent = "Set scale before calculating this element.";
    return;
  }
  if (result.missing.length) {
    box.classList.remove("hidden");
    box.textContent = `Missing required parameter: ${result.missing.join(", ")}. Insert it to proceed.`;
  } else {
    box.classList.add("hidden");
    box.textContent = "";
  }
}

function renderBoq() {
  const rows = state.shapes.filter((shape) => shape.saved && shape.boq);
  const tbody = document.getElementById("boqRows");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="14">No concrete elements saved yet.</td></tr>`;
  } else {
    tbody.innerHTML = rows.map((shape, index) => {
      const boq = shape.boq;
      const currentSteelCost = boq.reinforcement.weightKg * quoteSettings().steelRate;
      return `
        <tr>
          <td>${boq.page}</td>
          <td><b>${escapeHtml(boq.name)}</b><div>Qty ${fmtQty(boq.elementQuantity)} · ${shapeGeometryLabel(boq.shapeGeometry)}</div><div>${escapeHtml(boq.notes)}</div></td>
          <td>${labelType(boq.type)}</td>
          <td>${measuredText(boq.measured)}</td>
          <td>${fmt(boq.area)} m²</td>
          <td><b>${fmt(boq.volumeWithWaste)} m³</b><div>raw ${fmt(boq.volume)} m³</div></td>
          <td>${fmt(boq.formworkWithWaste)} m²</td>
          <td><b>${fmt(boq.reinforcement.weightKg)} kg</b><div>${escapeHtml(boq.reinforcement.description)}</div><div>${money(currentSteelCost)} steel</div></td>
          <td><b>${boq.dowels.count} dowels</b><div>${escapeHtml(boq.dowels.description)}</div><div>${money(boq.dowels.totalCost)}</div></td>
          <td><b>${fmt(boq.sawCut.lengthLm)} lm</b><div>${escapeHtml(boq.sawCut.description)}</div><div>${money(boq.sawCut.cost)}</div></td>
          <td><b>${money(boq.tools.totalCost)}</b><div>${escapeHtml(boq.tools.description)}</div></td>
          <td><b>${boq.manpower.crew} workers</b><div>${fmt(boq.manpower.workerDays)} worker-days</div><div>${fmt(boq.manpower.durationDays)} days min</div></td>
          <td><span class="status">complete</span></td>
          <td><button class="edit-line" data-index="${index}" type="button">Edit</button><button class="delete-line" data-index="${index}" type="button">X</button></td>
        </tr>
      `;
    }).join("");
  }
  renderTotals(rows);
  tbody.querySelectorAll(".edit-line").forEach((button) => button.addEventListener("click", () => {
    const saved = state.shapes.filter((shape) => shape.saved && shape.boq);
    const target = saved[Number(button.dataset.index)];
    editSavedShape(target);
  }));
  tbody.querySelectorAll(".delete-line").forEach((button) => button.addEventListener("click", () => {
    const saved = state.shapes.filter((shape) => shape.saved && shape.boq);
    const target = saved[Number(button.dataset.index)];
    state.shapes = state.shapes.filter((shape) => shape !== target);
    renderBoq();
    drawMarkup();
  }));
}

function editSavedShape(shape) {
  if (!shape?.boq) return;
  state.selectedShape = shape;
  fillFormFromBoq(shape.boq);
  document.querySelector(".properties")?.scrollIntoView({ behavior: "smooth", block: "start" });
  showMissingParameters();
  drawMarkup();
}

function fillFormFromBoq(boq) {
  Object.entries(boq).forEach(([key, value]) => {
    if (!form.elements[key]) return;
    form.elements[key].value = value ?? "";
  });
  form.elementQuantity.value = boq.elementQuantity || "";
  form.manualMeasure.value = boq.manualMeasure || "";
  form.manualMeasureUnit.value = boq.manualMeasureUnit || "auto";
}

function renderTotals(rows) {
  const area = rows.reduce((total, shape) => total + shape.boq.area, 0);
  const volume = rows.reduce((total, shape) => total + shape.boq.volumeWithWaste, 0);
  const formwork = rows.reduce((total, shape) => total + shape.boq.formworkWithWaste, 0);
  const reo = rows.reduce((total, shape) => total + shape.boq.reinforcement.weightKg, 0);
  const dowelCount = rows.reduce((total, shape) => total + shape.boq.dowels.count, 0);
  const dowelCost = rows.reduce((total, shape) => total + shape.boq.dowels.totalCost, 0);
  const sawCutLm = rows.reduce((total, shape) => total + shape.boq.sawCut.lengthLm, 0);
  const sawCutCost = rows.reduce((total, shape) => total + shape.boq.sawCut.cost, 0);
  const toolsCost = rows.reduce((total, shape) => total + shape.boq.tools.totalCost, 0);
  const settings = quoteSettings();
  const steelCost = reo * settings.steelRate;
  document.getElementById("totalArea").textContent = `${fmt(area)} m²`;
  document.getElementById("totalVolume").textContent = `${fmt(volume)} m³`;
  document.getElementById("totalFormwork").textContent = `${fmt(formwork)} m² FW`;
  document.getElementById("totalReo").textContent = `${fmt(reo)} kg reo`;
  document.getElementById("totalDowels").textContent = `${dowelCount} dowels`;
  document.getElementById("totalSawCut").textContent = `${fmt(sawCutLm)} lm saw cut`;
  document.getElementById("totalSteelCost").textContent = `${money(steelCost)} steel`;
  renderQuotationTotals({ volume, formwork, reo, dowelCost, sawCutCost, toolsCost, settings });
}

function quoteSettings() {
  return {
    steelRate: numberValue(document.getElementById("marketSteelRate").value),
    concreteRate: numberValue(document.getElementById("marketConcreteRate").value),
    formworkRate: numberValue(document.getElementById("marketFormworkRate").value),
    marginPercent: numberValue(document.getElementById("profitMargin").value)
  };
}

function renderQuotationTotals({ volume, formwork, reo, dowelCost, sawCutCost, toolsCost, settings }) {
  const concreteCost = volume * settings.concreteRate;
  const formworkCost = formwork * settings.formworkRate;
  const steelCost = reo * settings.steelRate;
  const subtotal = concreteCost + formworkCost + steelCost + dowelCost + sawCutCost + toolsCost;
  const margin = subtotal * (settings.marginPercent / 100);
  const total = subtotal + margin;
  document.getElementById("quoteConcrete").textContent = money(concreteCost);
  document.getElementById("quoteFormwork").textContent = money(formworkCost);
  document.getElementById("quoteSteel").textContent = money(steelCost);
  document.getElementById("quoteDowels").textContent = money(dowelCost);
  document.getElementById("quoteSawCut").textContent = money(sawCutCost);
  document.getElementById("quoteTools").textContent = money(toolsCost);
  document.getElementById("quoteSubtotal").textContent = money(subtotal);
  document.getElementById("quoteMargin").textContent = money(margin);
  document.getElementById("quoteTotal").textContent = money(total);
}

function drawMarkup() {
  markCtx.clearRect(0, 0, markupCanvas.width, markupCanvas.height);
  state.shapes.filter((shape) => shape.page === state.page).forEach((shape) => drawShape(shape, shape.saved ? "#146c64" : "#c57a1d"));
  if (state.polyPoints.length) drawPolyline(state.polyPoints, "#245b9d", false);
  if (state.scalePoints.length) drawScaleArrow(state.scalePoints, "#b8443f");
  if (state.drawing && state.start && state.preview) {
    drawShape({ kind: state.activeTool === "line" ? "line" : "rect", points: [state.start, state.preview] }, "#245b9d");
  }
}

function drawShape(shape, color) {
  markCtx.strokeStyle = color;
  markCtx.fillStyle = color + "22";
  markCtx.lineWidth = 3;
  if (shape.kind === "line") {
    drawPolyline(shape.points, color, false);
    return;
  }
  if (shape.kind === "rect") {
    const [a, b] = shape.points;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    markCtx.fillRect(x, y, w, h);
    markCtx.strokeRect(x, y, w, h);
    return;
  }
  drawPolyline(shape.points, color, true);
}

function drawPolyline(points, color, closed) {
  if (!points.length) return;
  markCtx.strokeStyle = color;
  markCtx.fillStyle = color + "22";
  markCtx.lineWidth = 3;
  markCtx.beginPath();
  markCtx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => markCtx.lineTo(point.x, point.y));
  if (closed) {
    markCtx.closePath();
    markCtx.fill();
  }
  markCtx.stroke();
  points.forEach((point) => {
    markCtx.beginPath();
    markCtx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    markCtx.fillStyle = color;
    markCtx.fill();
  });
}

function drawScaleArrow(points, color) {
  drawPolyline(points, color, false);
  if (points.length < 2) return;
  drawArrowHead(points[1], points[0], color);
  drawArrowHead(points[0], points[1], color);
}

function drawArrowHead(tip, tail, color) {
  const angle = Math.atan2(tip.y - tail.y, tip.x - tail.x);
  const size = 12;
  markCtx.beginPath();
  markCtx.moveTo(tip.x, tip.y);
  markCtx.lineTo(tip.x - size * Math.cos(angle - Math.PI / 6), tip.y - size * Math.sin(angle - Math.PI / 6));
  markCtx.lineTo(tip.x - size * Math.cos(angle + Math.PI / 6), tip.y - size * Math.sin(angle + Math.PI / 6));
  markCtx.closePath();
  markCtx.fillStyle = color;
  markCtx.fill();
}

function formValues() {
  return {
    name: form.name.value.trim(),
    type: form.type.value,
    shapeGeometry: form.shapeGeometry.value,
    elementQuantity: numberValue(form.elementQuantity.value) || 1,
    manualMeasure: numberValue(form.manualMeasure.value),
    manualMeasureUnit: form.manualMeasureUnit.value,
    thicknessMm: numberValue(form.thicknessMm.value),
    height: numberValue(form.height.value),
    width: numberValue(form.width.value),
    waste: numberValue(form.waste.value),
    tag: form.tag.value.trim().toUpperCase(),
    notes: form.notes.value.trim(),
    reoSource: form.reoSource.value,
    reoDirection: form.reoDirection.value,
    barDiameter: numberValue(form.barDiameter.value),
    barSpacing: numberValue(form.barSpacing.value),
    reoLayers: numberValue(form.reoLayers.value),
    reoKgPerM3: numberValue(form.reoKgPerM3.value),
    meshKgPerM2: numberValue(form.meshKgPerM2.value),
    steelRate: numberValue(form.steelRate.value),
    includeDowels: form.includeDowels.value,
    dowelDiameter: numberValue(form.dowelDiameter.value),
    dowelLengthMm: numberValue(form.dowelLengthMm.value),
    dowelEmbedmentMm: numberValue(form.dowelEmbedmentMm.value),
    dowelSpacingMm: numberValue(form.dowelSpacingMm.value),
    epoxyBrand: form.epoxyBrand.value,
    epoxyRatePerDowel: numberValue(form.epoxyRatePerDowel.value),
    sawCutRequired: form.sawCutRequired.value,
    sawCutLm: numberValue(form.sawCutLm.value),
    sawCutRate: numberValue(form.sawCutRate.value),
    sawCutProdLmPerDay: numberValue(form.sawCutProdLmPerDay.value),
    sawCutCrew: numberValue(form.sawCutCrew.value),
    tieWireKg: numberValue(form.tieWireKg.value),
    tieWireRate: numberValue(form.tieWireRate.value),
    smallToolsAllowance: numberValue(form.smallToolsAllowance.value),
    equipmentDamageAllowance: numberValue(form.equipmentDamageAllowance.value),
    minCrew: numberValue(form.minCrew.value),
    hoursPerDay: numberValue(form.hoursPerDay.value),
    prodM3PerWorkerDay: numberValue(form.prodM3PerWorkerDay.value),
    prodKgPerWorkerDay: numberValue(form.prodKgPerWorkerDay.value)
  };
}

function canvasPoint(event) {
  const rect = markupCanvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (markupCanvas.width / rect.width),
    y: (event.clientY - rect.top) * (markupCanvas.height / rect.height)
  };
}

function goPage(delta) {
  if (!state.pdf) return;
  state.page = Math.max(1, Math.min(state.pageCount, state.page + delta));
  renderPage();
}

function clearAll() {
  if (!confirm("Clear all markups and BOQ lines?")) return;
  state.shapes = [];
  state.selectedShape = null;
  state.polyPoints = [];
  renderBoq();
  drawMarkup();
}

function exportCsv() {
  const settings = quoteSettings();
  const rows = state.shapes.filter((shape) => shape.saved && shape.boq).map((shape) => {
    const b = shape.boq;
    return [
      b.page,
      b.name,
      b.tag,
      labelType(b.type),
      b.shapeGeometry,
      b.elementQuantity,
      b.manualMeasure,
      b.manualMeasureUnit,
      measuredText(b.measured),
      fmt(b.area),
      fmt(b.volumeWithWaste),
      fmt(b.formworkWithWaste),
      fmt(b.reinforcement.weightKg),
      money(b.reinforcement.weightKg * settings.steelRate),
      b.reinforcement.description,
      b.reoDirection,
      b.dowels.count,
      fmt(b.dowels.barWeightKg),
      b.dowels.description,
      money(b.dowels.totalCost),
      fmt(b.sawCut.lengthLm),
      b.sawCut.description,
      money(b.sawCut.cost),
      fmt(b.tools.tieWireKg),
      money(b.tools.tieWireCost),
      money(b.tools.smallToolsCost),
      money(b.tools.equipmentDamageCost),
      money(b.tools.totalCost),
      b.manpower.crew,
      fmt(b.manpower.workerDays),
      fmt(b.manpower.durationDays),
      b.notes
    ];
  });
  const csv = [["page", "name", "tag", "type", "shape_geometry", "quantity", "manual_measure", "manual_measure_unit", "measured", "area_m2", "volume_m3", "formwork_m2", "reo_kg", "steel_cost", "reo_basis", "reo_direction", "dowel_count", "dowel_steel_kg", "dowel_basis", "dowel_epoxy_steel_cost", "saw_cut_lm", "saw_cut_basis", "saw_cut_cost", "tie_wire_kg", "tie_wire_cost", "small_tools_cost", "equipment_damage_cost", "tools_total_cost", "min_crew", "worker_days", "duration_days", "notes"], ...rows]
    .map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "concrete-plan-boq.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function polygonArea(points) {
  let total = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    total += point.x * next.y - next.x * point.y;
  });
  return Math.abs(total / 2);
}

function polygonPerimeter(points) {
  return points.reduce((total, point, index) => total + distance(point, points[(index + 1) % points.length]), 0);
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function labelType(type) {
  return {
    slab: "Slab",
    isolatedFooting: "Isolated footing",
    padFooting: "Pad footing",
    wall: "Wall",
    column: "Column / round",
    beam: "Beam"
  }[type] || type;
}

function shapeGeometryLabel(value) {
  return {
    regular: "regular shape",
    irregular: "irregular / messy shape",
    curved: "curved edge",
    assumed: "assumed from tender note"
  }[value] || "regular shape";
}

function measuredText(measured) {
  const qtyText = measured.quantity && measured.quantity !== 1 ? `, qty ${fmtQty(measured.quantity)}` : "";
  const manualText = measured.manualMeasure ? `, override ${fmt(measured.manualMeasure)} ${measured.manualMeasureUnit}` : "";
  if (measured.area) return `${fmt(measured.area)} m², ${fmt(measured.perimeter)} lm${qtyText}${manualText}`;
  return `${fmt(measured.length)} lm${qtyText}${manualText}`;
}

function numberValue(value) {
  return Number.parseFloat(value) || 0;
}

function parsePlanScale(value) {
  const clean = String(value || "").trim().replace(/\s+/g, "");
  const match = clean.match(/^1(?::|\/)(\d+(?:\.\d+)?)$/);
  if (!match) return 0;
  return Number.parseFloat(match[1]) || 0;
}

function gridScaleLabel() {
  const first = document.getElementById("firstGridName").value.trim();
  const second = document.getElementById("secondGridName").value.trim();
  if (first && second) return `${first} to ${second}`;
  if (first || second) return `${first || "first grid"} to ${second || "second grid"}`;
  return "the selected grid dimension";
}

function fmtKnown(value) {
  return Number(value || 0).toFixed(3).replace(/\.?0+$/, "");
}

function fmt(value) {
  return Number(value || 0).toFixed(3);
}

function fmtQty(value) {
  return Number(value || 1).toFixed(3).replace(/\.?0+$/, "");
}

function money(value) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
