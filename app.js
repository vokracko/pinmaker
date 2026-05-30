const state = {
  pinDiameter: 5.8,
  totalDiameter: 7.0,
  images: [],
  currentIndex: -1
};

const STATE_KEY = 'pinmaker_settings';
const CROP_MEMORY_KEY = 'pinmaker_crop_memory';

function saveSettings() {
  localStorage.setItem(STATE_KEY, JSON.stringify({
    pinDiameter: state.pinDiameter,
    totalDiameter: state.totalDiameter
  }));
}

function getCropMemory() {
  try {
    return JSON.parse(localStorage.getItem(CROP_MEMORY_KEY)) || {};
  } catch (e) { return {}; }
}

function saveCropMemory() {
  if (state.images.length === 0) return;
  const memory = getCropMemory();
  state.images.forEach(img => {
    memory[img.fingerprint] = {
      crop: { ...img.crop },
      duplicates: img.duplicates
    };
  });
  
  // Prevent infinite growth (keep last 500 images)
  const keys = Object.keys(memory);
  if (keys.length > 500) {
    const toDelete = keys.slice(0, keys.length - 500);
    toDelete.forEach(k => delete memory[k]);
  }
  
  localStorage.setItem(CROP_MEMORY_KEY, JSON.stringify(memory));
}


// DOM Elements
const els = {
  pinDiameterInput: document.getElementById('pinDiameterInput'),
  totalDiameterInput: document.getElementById('totalDiameterInput'),
  dimensionError: document.getElementById('dimensionError'),
  fileInput: document.getElementById('fileInput'),
  selectImagesBtn: document.getElementById('selectImagesBtn'),
  addMoreBtn: document.getElementById('addMoreBtn'),
  cropSection: document.getElementById('cropSection'),
  cropEmptyState: document.getElementById('cropEmptyState'),
  cropEditor: document.getElementById('cropEditor'),
  cropCanvas: document.getElementById('cropCanvas'),
  zoomSlider: document.getElementById('zoomSlider'),
  zoomLabel: document.getElementById('zoomLabel'),
  zoomInBtn: document.getElementById('zoomInBtn'),
  zoomOutBtn: document.getElementById('zoomOutBtn'),
  resetCropBtn: document.getElementById('resetCropBtn'),
  thumbnailSection: document.getElementById('thumbnailSection'),
  thumbnailStrip: document.getElementById('thumbnailStrip'),
  generateSection: document.getElementById('generateSection'),
  generatePdfBtn: document.getElementById('generatePdfBtn'),
  pinCount: document.getElementById('pinCount')
};

// Setup Canvas Context
const ctx = els.cropCanvas.getContext('2d');
let isDragging = false;
let startDragX = 0;
let startDragY = 0;
let rafId = null;

async function init() {
  els.selectImagesBtn.addEventListener('click', () => els.fileInput.click());
  els.addMoreBtn.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', handleFileSelect);
  
  els.pinDiameterInput.addEventListener('input', updateDimensions);
  els.totalDiameterInput.addEventListener('input', updateDimensions);
  
  els.zoomSlider.addEventListener('input', handleZoomInput);
  els.zoomInBtn.addEventListener('click', () => stepZoom(1));
  els.zoomOutBtn.addEventListener('click', () => stepZoom(-1));
  els.resetCropBtn.addEventListener('click', resetCurrentCrop);
  
  setupCanvasInteractions();
  
  const saved = localStorage.getItem(STATE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.pinDiameter) els.pinDiameterInput.value = parsed.pinDiameter;
      if (parsed.totalDiameter) els.totalDiameterInput.value = parsed.totalDiameter;
      updateDimensions();
    } catch (e) {}
  }
}

function updateUIForImages(indexToSelect) {
  els.cropEmptyState.hidden = true;
  els.cropEditor.hidden = false;
  els.thumbnailSection.hidden = false;
  els.generateSection.hidden = false;
  
  resizeCanvas();
  selectImage(indexToSelect);
  updateThumbnails();
  updatePinCount();
}

// Settings changes
function updateDimensions() {
  const pd = parseFloat(els.pinDiameterInput.value);
  const td = parseFloat(els.totalDiameterInput.value);
  
  if (isNaN(pd) || isNaN(td) || pd <= 0 || td <= 0) return;
  
  if (td < pd) {
    els.dimensionError.hidden = false;
    els.generatePdfBtn.disabled = true;
    return;
  }
  
  els.dimensionError.hidden = true;
  els.generatePdfBtn.disabled = false;
  
  state.pinDiameter = pd;
  state.totalDiameter = td;
  
  state.images.forEach(img => {
    calculateMinZoom(img);
    if (img.crop.zoom < img.crop.minZoom) img.crop.zoom = img.crop.minZoom;
  });
  
  if (state.currentIndex >= 0) {
    updateZoomSliderLimits();
    scheduleRender();
  }
  saveSettings();
  saveCropMemory();
}

// File Handling
async function handleFileSelect(e) {
  const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
  if (files.length === 0) return;
  
  const memory = getCropMemory();
  
  for (const file of files) {
    try {
      const fingerprint = `${file.name}_${file.size}_${file.lastModified}`;
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.src = objectUrl;
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
      });
      
      const savedState = memory[fingerprint];
      
      const imgData = {
        id: Date.now() + Math.random(),
        fingerprint: fingerprint,
        file: file,
        objectUrl: objectUrl,
        bitmap: img,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        crop: {
          offsetX: 0,
          offsetY: 0,
          zoom: 1.0,
          minZoom: 1.0,
          edited: false
        },
        duplicates: 1
      };
      
      calculateMinZoom(imgData);
      
      if (savedState) {
        imgData.crop = { ...imgData.crop, ...savedState.crop };
        if (imgData.crop.zoom < imgData.crop.minZoom) imgData.crop.zoom = imgData.crop.minZoom;
        imgData.duplicates = savedState.duplicates || 1;
      } else {
        imgData.crop.zoom = imgData.crop.minZoom;
      }
      
      state.images.push(imgData);
    } catch (err) {
      console.error("Error loading image", file.name, err);
    }
  }
  
  els.fileInput.value = ''; // Reset
  
  if (state.images.length > 0) {
    if (state.currentIndex === -1) {
      updateUIForImages(0);
    } else {
      updateThumbnails();
      updatePinCount();
    }
    saveCropMemory();
  }
}

function calculateMinZoom(imgData) {
  // Allow zooming out so the image's shortest side matches the inner pin diameter.
  const ratio = state.pinDiameter / state.totalDiameter;
  imgData.crop.minZoom = ratio;
}

// Thumbnails
function updateThumbnails() {
  els.thumbnailStrip.innerHTML = '';
  
  state.images.forEach((img, idx) => {
    const item = document.createElement('div');
    item.className = 'thumb-item';
    
    const btn = document.createElement('button');
    btn.className = 'thumb-btn';
    if (idx === state.currentIndex) btn.classList.add('active');
    btn.onclick = () => selectImage(idx);
    
    const imageEl = document.createElement('img');
    imageEl.src = img.objectUrl;
    imageEl.alt = "Thumbnail";
    
    const status = document.createElement('div');
    status.className = 'thumb-status';
    status.textContent = img.crop.edited ? '✏️' : '✓';
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'thumb-remove';
    removeBtn.innerHTML = '×';
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      removeImage(idx);
    };
    
    btn.appendChild(imageEl);
    btn.appendChild(status);
    btn.appendChild(removeBtn);
    
    const copies = document.createElement('div');
    copies.className = 'thumb-copies';
    copies.innerHTML = `×`;
    
    const input = document.createElement('input');
    input.type = 'number';
    input.min = 1;
    input.max = 50;
    input.value = img.duplicates;
    input.onchange = (e) => {
      img.duplicates = parseInt(e.target.value) || 1;
      updatePinCount();
      saveCropMemory();
    };
    
    copies.appendChild(input);
    
    item.appendChild(btn);
    item.appendChild(copies);
    els.thumbnailStrip.appendChild(item);
  });
}

function selectImage(idx) {
  state.currentIndex = idx;
  updateZoomSliderLimits();
  updateThumbnails();
  scheduleRender();
}

function removeImage(idx) {
  state.images.splice(idx, 1);
  if (state.images.length === 0) {
    state.currentIndex = -1;
    els.cropEmptyState.hidden = false;
    els.cropEditor.hidden = true;
    els.thumbnailSection.hidden = true;
    els.generateSection.hidden = true;
  } else {
    if (state.currentIndex >= state.images.length) {
      state.currentIndex = state.images.length - 1;
    } else if (state.currentIndex > idx) {
      state.currentIndex--;
    }
    selectImage(state.currentIndex);
  }
  updatePinCount();
  saveCropMemory();
}

function updatePinCount() {
  const count = state.images.reduce((sum, img) => sum + img.duplicates, 0);
  els.pinCount.textContent = count;
}

// Canvas & Crop logic
function resizeCanvas() {
  const rect = els.cropCanvas.parentElement.getBoundingClientRect();
  // Rely on the wrapper's width which is enforced to be square
  const expectedSize = Math.round(rect.width);
  if (expectedSize === 0) return;
  
  const dpr = window.devicePixelRatio || 1;
  const newWidth = Math.round(expectedSize * dpr);
  
  if (els.cropCanvas.width !== newWidth) {
    els.cropCanvas.width = newWidth;
    els.cropCanvas.height = newWidth;
    // Do NOT set style.width/height here, let CSS aspect-ratio handle the display box!
    scheduleRender();
  }
}
window.addEventListener('resize', resizeCanvas);

function getActiveImage() {
  if (state.currentIndex >= 0 && state.currentIndex < state.images.length) {
    return state.images[state.currentIndex];
  }
  return null;
}

function setupCanvasInteractions() {
  const canvas = els.cropCanvas;
  
  canvas.addEventListener('pointerdown', e => {
    isDragging = true;
    startDragX = e.clientX;
    startDragY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  
  canvas.addEventListener('pointermove', e => {
    if (!isDragging) return;
    const dx = e.clientX - startDragX;
    const dy = e.clientY - startDragY;
    startDragX = e.clientX;
    startDragY = e.clientY;
    
    panImage(dx, dy);
  });
  
  canvas.addEventListener('pointerup', e => {
    isDragging = false;
    canvas.releasePointerCapture(e.pointerId);
    saveCropMemory();
  });
  
  canvas.addEventListener('pointercancel', e => {
    isDragging = false;
    canvas.releasePointerCapture(e.pointerId);
  });
  
  let wheelTimeout;
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const zoomDelta = e.deltaY > 0 ? -0.05 : 0.05;
    const img = getActiveImage();
    if (img) {
      setZoom(img.crop.zoom + zoomDelta);
      clearTimeout(wheelTimeout);
      wheelTimeout = setTimeout(saveCropMemory, 500);
    }
  });
  
  // Basic keyboard pan/zoom
  canvas.addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '-', 'r'].includes(e.key)) {
      e.preventDefault();
      const img = getActiveImage();
      if (!img) return;
      
      let step = 10;
      if (e.key === 'ArrowUp') panImage(0, step);
      if (e.key === 'ArrowDown') panImage(0, -step);
      if (e.key === 'ArrowLeft') panImage(step, 0);
      if (e.key === 'ArrowRight') panImage(-step, 0);
      if (e.key === '+') setZoom(img.crop.zoom + 0.05);
      if (e.key === '-') setZoom(img.crop.zoom - 0.05);
      if (e.key === 'r') resetCurrentCrop();
      
      clearTimeout(wheelTimeout);
      wheelTimeout = setTimeout(saveCropMemory, 500);
    }
  });
}

function panImage(dx, dy) {
  const img = getActiveImage();
  if (!img) return;
  
  // Convert dx, dy from CSS pixels to image pixels
  // CSS canvas size
  const dpr = window.devicePixelRatio || 1;
  const canvasSize = els.cropCanvas.width / dpr;
  const radiusPx = canvasSize * 0.4; // 40% of canvas is the total diameter radius
  
  // Scale factor: how many CSS pixels is one image pixel?
  // zoom = 1.0 means shortest side maps to total diameter (2 * radiusPx)
  const shortest = Math.min(img.naturalWidth, img.naturalHeight);
  const baseScale = (2 * radiusPx) / shortest;
  const currentScale = baseScale * img.crop.zoom;
  
  img.crop.offsetX += dx / currentScale;
  img.crop.offsetY += dy / currentScale;
  img.crop.edited = true;
  
  clampPan(img);
  scheduleRender();
  updateThumbnails();
}

function clampPan(img) {
  // Ensure the image bounds enclose the inner pin circle (since user can zoom out to it)
  const shortest = Math.min(img.naturalWidth, img.naturalHeight);
  const ratio = state.pinDiameter / state.totalDiameter;
  // pin circle radius in image space
  const r = (shortest / 2 / img.crop.zoom) * ratio;
  
  const wLimit = Math.max(0, img.naturalWidth / 2 - r);
  const hLimit = Math.max(0, img.naturalHeight / 2 - r);
  
  if (img.crop.offsetX > wLimit) img.crop.offsetX = wLimit;
  if (img.crop.offsetX < -wLimit) img.crop.offsetX = -wLimit;
  if (img.crop.offsetY > hLimit) img.crop.offsetY = hLimit;
  if (img.crop.offsetY < -hLimit) img.crop.offsetY = -hLimit;
}

function updateZoomSliderLimits() {
  const img = getActiveImage();
  if (!img) return;
  els.zoomSlider.min = img.crop.minZoom;
  els.zoomSlider.max = img.crop.minZoom * 5;
  els.zoomSlider.value = img.crop.zoom;
  updateZoomLabel(img.crop.zoom);
}

function handleZoomInput(e) {
  setZoom(parseFloat(e.target.value));
}
els.zoomSlider.addEventListener('change', saveCropMemory);

function stepZoom(dir) {
  const img = getActiveImage();
  if (img) {
    setZoom(img.crop.zoom + dir * 0.1);
    saveCropMemory();
  }
}

function setZoom(val) {
  const img = getActiveImage();
  if (!img) return;
  
  val = Math.max(img.crop.minZoom, Math.min(val, img.crop.minZoom * 5));
  img.crop.zoom = val;
  img.crop.edited = true;
  
  els.zoomSlider.value = val;
  updateZoomLabel(val);
  
  clampPan(img); // Re-clamp panning because radius changed
  scheduleRender();
  updateThumbnails();
  saveCropMemory();
}

function updateZoomLabel(val) {
  els.zoomLabel.textContent = Math.round(val * 100) + '%';
}

function resetCurrentCrop() {
  const img = getActiveImage();
  if (!img) return;
  img.crop.offsetX = 0;
  img.crop.offsetY = 0;
  img.crop.zoom = img.crop.minZoom;
  img.crop.edited = false;
  
  updateZoomSliderLimits();
  scheduleRender();
  updateThumbnails();
  saveCropMemory();
}

function scheduleRender() {
  if (!rafId) {
    rafId = requestAnimationFrame(renderCanvas);
  }
}

function renderCanvas() {
  rafId = null;
  const canvas = els.cropCanvas;
  
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const expectedWidth = Math.round(rect.width * dpr);
  
  if (expectedWidth > 0 && canvas.width !== expectedWidth) {
    resizeCanvas();
    return;
  }
  
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  
  // 1. Clear background
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, w, h);
  
  const img = getActiveImage();
  if (!img) return;
  
  const cx = w / 2;
  const cy = h / 2;
  
  // We want the total diameter to take up 80% of the canvas size
  const totalDiamPx = Math.min(w, h) * 0.8;
  const totalRadiusPx = totalDiamPx / 2;
  
  // Calculate pin diameter in pixels based on the ratio
  const ratio = state.pinDiameter / state.totalDiameter;
  const pinRadiusPx = totalRadiusPx * ratio;
  
  // Draw image
  ctx.save();
  ctx.translate(cx, cy);
  
  // scale factor
  const shortest = Math.min(img.naturalWidth, img.naturalHeight);
  const baseScale = totalDiamPx / shortest;
  const scale = baseScale * img.crop.zoom;
  
  ctx.scale(scale, scale);
  ctx.translate(img.crop.offsetX, img.crop.offsetY);
  
  // Draw bitmap centered
  ctx.drawImage(img.bitmap, -img.naturalWidth / 2, -img.naturalHeight / 2);
  
  ctx.restore();
  
  // Overlay
  ctx.save();
  
  // Dim everything outside total diameter
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, w, h);
  
  // Cut out total circle
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(cx, cy, totalRadiusPx, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.globalCompositeOperation = 'source-over';
  
  // Bleed ring tint (between pin and total)
  ctx.beginPath();
  ctx.arc(cx, cy, totalRadiusPx, 0, Math.PI * 2);
  ctx.arc(cx, cy, pinRadiusPx, 0, Math.PI * 2, true); // counter-clockwise to make a donut
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fill();
  
  // Guides
  ctx.beginPath();
  ctx.arc(cx, cy, totalRadiusPx, 0, Math.PI * 2);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.stroke();
  
  ctx.beginPath();
  ctx.arc(cx, cy, pinRadiusPx, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  
  ctx.restore();
}

// Ensure init runs
document.addEventListener('DOMContentLoaded', init);

// Expose state for PDF generation
window.pinmakerState = state;
