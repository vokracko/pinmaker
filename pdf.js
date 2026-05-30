const pdfEls = {
  btn: document.getElementById('generatePdfBtn'),
  progressBar: document.getElementById('progressBar'),
  progressFill: document.getElementById('progressFill'),
  progressLabel: document.getElementById('progressLabel'),
  completionMsg: document.getElementById('completionMsg'),
  redownloadLink: document.getElementById('redownloadLink')
};

pdfEls.btn.addEventListener('click', generatePdf);

async function generatePdf() {
  const state = window.pinmakerState;
  if (!state || state.images.length === 0) return;
  
  // UI states
  pdfEls.btn.hidden = true;
  pdfEls.completionMsg.hidden = true;
  pdfEls.progressBar.hidden = false;
  pdfEls.progressFill.style.width = '0%';
  
  try {
    // Collect all pins to generate (unroll duplicates)
    const pinsToRender = [];
    state.images.forEach(img => {
      for (let i = 0; i < img.duplicates; i++) {
        pinsToRender.push(img);
      }
    });
    
    const totalPins = pinsToRender.length;
    let renderedCount = 0;
    pdfEls.progressLabel.textContent = `Generating PDF… 0/${totalPins} pins`;
    
    // Constants for Layout
    const PAGE_W = 210; // mm
    const PAGE_H = 297; // mm
    const MARGIN = 10;  // mm
    const SPACING = 2;  // mm
    const PIN_MM = state.totalDiameter * 10;
    const CELL_MM = PIN_MM + SPACING;
    
    const printW = PAGE_W - 2 * MARGIN + SPACING; // add spacing back to right edge
    const printH = PAGE_H - 2 * MARGIN + SPACING; // add spacing back to bottom edge
    
    const cols = Math.floor(printW / CELL_MM);
    const rows = Math.floor(printH / CELL_MM);
    const pinsPerPage = cols * rows;
    
    // 300 DPI -> pixels
    const pxPerInch = 300;
    const pxPerCm = pxPerInch / 2.54;
    const canvasSize = Math.ceil(state.totalDiameter * pxPerCm);
    const halfSize = canvasSize / 2;
    
    // Cache for rendered images
    const imageCache = new Map();
    
    // Helper to render an image to a Data URL
    const renderImageToDataUrl = (img) => {
      if (imageCache.has(img.id)) return imageCache.get(img.id);
      
      const offCanvas = document.createElement('canvas');
      offCanvas.width = canvasSize;
      offCanvas.height = canvasSize;
      const ctx = offCanvas.getContext('2d');
      
      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvasSize, canvasSize);
      
      // Circular clip mask
      ctx.beginPath();
      ctx.arc(halfSize, halfSize, halfSize, 0, Math.PI * 2);
      ctx.clip();
      
      // Draw image
      ctx.save();
      ctx.translate(halfSize, halfSize);
      
      const shortest = Math.min(img.naturalWidth, img.naturalHeight);
      const baseScale = canvasSize / shortest;
      const scale = baseScale * img.crop.zoom;
      
      ctx.scale(scale, scale);
      ctx.translate(img.crop.offsetX, img.crop.offsetY);
      
      ctx.drawImage(img.bitmap, -img.naturalWidth / 2, -img.naturalHeight / 2);
      ctx.restore();
      
      // Draw 1px black circular border
      ctx.beginPath();
      ctx.arc(halfSize, halfSize, halfSize - 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.stroke();
      
      const dataUrl = offCanvas.toDataURL('image/jpeg', 0.95);
      imageCache.set(img.id, dataUrl);
      return dataUrl;
    };
    
    // Create jsPDF instance
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });
    
    const addFooter = () => {
      doc.setFontSize(8);
      doc.setTextColor(128, 128, 128);
      doc.text("Print at 100% scale (Actual Size). Do not use Fit to Page.", PAGE_W / 2, PAGE_H - 5, { align: 'center' });
    };
    
    addFooter(); // for first page
    
    // Layout
    for (let i = 0; i < pinsToRender.length; i++) {
      const img = pinsToRender[i];
      const dataUrl = renderImageToDataUrl(img);
      
      const pageIndex = Math.floor(i / pinsPerPage);
      const indexOnPage = i % pinsPerPage;
      
      if (indexOnPage === 0 && pageIndex > 0) {
        doc.addPage();
        addFooter();
      }
      
      const c = indexOnPage % cols;
      const r = Math.floor(indexOnPage / cols);
      
      const x = MARGIN + c * CELL_MM;
      const y = MARGIN + r * CELL_MM;
      
      doc.addImage(dataUrl, 'JPEG', x, y, PIN_MM, PIN_MM);
      
      renderedCount++;
      pdfEls.progressFill.style.width = `${(renderedCount / totalPins) * 100}%`;
      pdfEls.progressLabel.textContent = `Generating PDF… ${renderedCount}/${totalPins} pins`;
      
      // Let the browser paint updates periodically
      if (i % 5 === 0) {
        await new Promise(res => setTimeout(res, 0));
      }
    }
    
    // Save PDF
    const blob = doc.output('blob');
    const blobUrl = URL.createObjectURL(blob);
    
    // Primary delivery: Auto download
    pdfEls.redownloadLink.href = blobUrl;
    pdfEls.redownloadLink.click();
    
    // Secondary delivery: Try open in new tab
    try {
      window.open(blobUrl, '_blank');
    } catch (e) {
      // Popups blocked, ignore
    }
    
    // Finish UI
    pdfEls.progressBar.hidden = true;
    pdfEls.completionMsg.hidden = false;
    setTimeout(() => {
      pdfEls.btn.hidden = false;
      pdfEls.completionMsg.hidden = true;
    }, 5000); // show generate button again after 5 seconds
    
  } catch (err) {
    console.error("PDF generation failed:", err);
    pdfEls.progressLabel.textContent = "❌ Error generating PDF";
    pdfEls.progressFill.style.backgroundColor = "var(--danger-color)";
    
    setTimeout(() => {
      pdfEls.btn.hidden = false;
      pdfEls.progressBar.hidden = true;
      pdfEls.progressFill.style.backgroundColor = "var(--primary-color)";
    }, 3000);
  }
}
