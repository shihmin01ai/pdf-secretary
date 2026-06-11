// Initialize PDF.js worker
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Application State
const state = {
  files: new Map(), // fileId -> { id, name, size, bytes, pdfjsDoc, pdfLibDoc }
  pages: [],        // Array of: { id, fileId, pageNumber, rotation, selected, renderedCanvas }
  zoomLevel: 'medium' // 'small', 'medium', 'large'
};

// UI Elements
const themeToggle = document.getElementById('theme-toggle');
const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const filesList = document.getElementById('files-list');
const clearAllBtn = document.getElementById('clear-all-btn');

const batchActionsPanel = document.getElementById('batch-actions-panel');
const selectedCount = document.getElementById('selected-count');
const batchRotateBtn = document.getElementById('batch-rotate-btn');
const batchDeleteBtn = document.getElementById('batch-delete-btn');
const batchClearBtn = document.getElementById('batch-clear-btn');

const exportMergedBtn = document.getElementById('export-merged-btn');
const exportSplitBtn = document.getElementById('export-split-btn');

const pageCountBadge = document.getElementById('page-count-badge');
const workspaceControls = document.getElementById('workspace-controls');
const selectAllBtn = document.getElementById('select-all-btn');
const deselectAllBtn = document.getElementById('deselect-all-btn');

const zoomOutBtn = document.getElementById('zoom-out-btn');
const zoomInBtn = document.getElementById('zoom-in-btn');
const zoomLabel = document.getElementById('zoom-label');

const pagesGridContainer = document.getElementById('pages-grid-container');
const pagesGrid = document.getElementById('pages-grid');

const loadingOverlay = document.getElementById('loading-overlay');
const loadingMessage = document.getElementById('loading-message');
const toast = document.getElementById('toast');

// Global drag state tracker
let draggedCard = null;

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupEventListeners();
  updateUI();
  initEditor(); // Initialize PDF Page Editor
});

// Theme Setup
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  showToast(newTheme === 'dark' ? '已切換至深色模式' : '已切換至淺色模式', 'success');
}

// Event Listeners
function setupEventListeners() {
  themeToggle.addEventListener('click', toggleTheme);

  // File selection
  fileInput.addEventListener('change', handleFileSelect);

  // Drag and drop for upload
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  });

  // Clear all files
  clearAllBtn.addEventListener('click', clearAll);

  // Zoom controls
  zoomInBtn.addEventListener('click', () => adjustZoom(1));
  zoomOutBtn.addEventListener('click', () => adjustZoom(-1));

  // Selection actions
  selectAllBtn.addEventListener('click', () => toggleAllSelection(true));
  deselectAllBtn.addEventListener('click', () => toggleAllSelection(false));

  // Batch actions
  batchClearBtn.addEventListener('click', () => toggleAllSelection(false));
  batchRotateBtn.addEventListener('click', handleBatchRotate);
  batchDeleteBtn.addEventListener('click', handleBatchDelete);

  // Export buttons
  exportMergedBtn.addEventListener('click', exportMergedPDF);
  exportSplitBtn.addEventListener('click', exportSplitPDF);
}

// Show Toast Notification
function showToast(message, type = 'success') {
  toast.innerText = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Show/Hide Loading Overlay
function showLoading(show, message = '正在處理 PDF 檔案...') {
  loadingMessage.innerText = message;
  loadingOverlay.style.display = show ? 'flex' : 'none';
}

// Handle File Select
function handleFileSelect(e) {
  if (e.target.files.length > 0) {
    processFiles(e.target.files);
    fileInput.value = ''; // Reset file input
  }
}

// Process Files
async function processFiles(fileList) {
  const pdfFiles = Array.from(fileList).filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));

  if (pdfFiles.length === 0) {
    showToast('請上傳有效的 PDF 檔案！', 'error');
    return;
  }

  showLoading(true, `正在載入 ${pdfFiles.length} 個檔案...`);

  for (const file of pdfFiles) {
    const fileId = 'file-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now();
    try {
      const arrayBuffer = await readFileAsArrayBuffer(file);
      const uint8Array = new Uint8Array(arrayBuffer);

      // Load using PDF.js for rendering
      // We slice the uint8Array to pass a copy to PDF.js. This prevents PDF.js
      // from detaching/neutering the original ArrayBuffer on the main thread,
      // keeping state.files bytes valid for PDF-lib manipulation during export.
      const pdfjsDoc = await pdfjsLib.getDocument({ data: uint8Array.slice(0) }).promise;

      state.files.set(fileId, {
        id: fileId,
        name: file.name,
        size: file.size,
        bytes: uint8Array,
        pdfjsDoc: pdfjsDoc,
        pdfLibDoc: null // lazy load when exporting
      });

      // Add pages to workspace
      for (let i = 1; i <= pdfjsDoc.numPages; i++) {
        state.pages.push({
          id: 'page-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now(),
          fileId: fileId,
          pageNumber: i,
          rotation: 0,
          selected: false,
          renderedCanvas: null
        });
      }

      showToast(`已載入 ${file.name} (共 ${pdfjsDoc.numPages} 頁)`, 'success');
    } catch (err) {
      console.error(err);
      showToast(`載入 ${file.name} 失敗，可能檔案已受損。`, 'error');
    }
  }

  showLoading(false);
  updateUI();
}

// File Reader Helper
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

// Update UI States
function updateUI() {
  renderFilesList();
  renderGrid();
  updateSidebarControls();
}

// Render Loaded Files Sidebar List
function renderFilesList() {
  if (state.files.size === 0) {
    filesList.innerHTML = '<div class="empty-files-text">尚未載入任何 PDF 檔案</div>';
    clearAllBtn.style.display = 'none';
    return;
  }

  clearAllBtn.style.display = 'inline-block';
  filesList.innerHTML = '';

  state.files.forEach((file) => {
    const item = document.createElement('div');
    item.className = 'file-item';

    const sizeKB = (file.size / 1024).toFixed(1);
    const sizeStr = sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;

    item.innerHTML = `
      <div class="file-info">
        <i data-lucide="file" class="file-icon"></i>
        <div class="file-meta">
          <span class="file-name" title="${file.name}">${file.name}</span>
          <span class="file-size">共 ${file.pdfjsDoc.numPages} 頁 | ${sizeStr}</span>
        </div>
      </div>
      <button class="card-btn card-btn-danger remove-file-btn" data-id="${file.id}" title="移除此檔案所有頁面">
        <i data-lucide="trash-2"></i>
      </button>
    `;

    // Attach remove handler
    item.querySelector('.remove-file-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      removeFile(file.id);
    });

    filesList.appendChild(item);
  });

  lucide.createIcons();
}

// Render Pages Workspace Grid
function renderGrid() {
  const emptyState = document.getElementById('empty-state');
  if (state.pages.length === 0) {
    pagesGridContainer.classList.add('empty');
    if (emptyState) emptyState.style.display = 'block';
    pagesGrid.innerHTML = '';
    pageCountBadge.style.display = 'none';
    workspaceControls.style.display = 'none';
    lucide.createIcons();
    return;
  }

  pagesGridContainer.classList.remove('empty');
  if (emptyState) emptyState.style.display = 'none';
  pagesGrid.innerHTML = '';

  pageCountBadge.style.display = 'inline-block';
  pageCountBadge.innerText = `共 ${state.pages.length} 頁`;
  workspaceControls.style.display = 'flex';

  state.pages.forEach((page, index) => {
    const file = state.files.get(page.fileId);
    const fileName = file ? file.name : '未知來源';

    const card = document.createElement('div');
    card.className = `page-card ${page.selected ? 'selected' : ''}`;
    card.setAttribute('draggable', 'true');
    card.setAttribute('data-id', page.id);

    card.innerHTML = `
      <div class="card-header-overlay">
        <div class="page-select-checkbox" title="選取此頁">
          <i data-lucide="check"></i>
        </div>
        <span class="file-source-badge" title="${fileName}">${fileName}</span>
      </div>
      <div class="card-thumbnail-container">
        <!-- Canvas thumbnail will be appended here -->
      </div>
      <div class="card-footer">
        <span class="page-number-label">第 ${index + 1} 頁</span>
        <div class="card-actions">
          <button class="card-btn edit-btn" title="編輯此頁">
            <i data-lucide="edit-3"></i>
          </button>
          <button class="card-btn rotate-btn" title="順時針旋轉 90°">
            <i data-lucide="rotate-cw"></i>
          </button>
          <button class="card-btn card-btn-danger delete-btn" title="刪除此頁">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
    `;

    // Render thumbnail
    const thumbContainer = card.querySelector('.card-thumbnail-container');
    if (page.renderedCanvas) {
      // Re-use cached canvas to prevent visual flash
      thumbContainer.appendChild(page.renderedCanvas);
    } else {
      thumbContainer.innerHTML = '<div class="thumbnail-spinner"></div>';
      // Asynchronously render and cache
      renderPageThumbnail(page, thumbContainer);
    }

    // Attach Selection toggle to checkbox click
    card.querySelector('.page-select-checkbox').addEventListener('click', (e) => {
      e.stopPropagation();
      togglePageSelection(page.id);
    });

    // Toggle selection when clicking anywhere on the card, EXCEPT on buttons
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-btn') || e.target.closest('.page-select-checkbox')) return;
      togglePageSelection(page.id);
    });

    // Attach Edit click
    card.querySelector('.edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditor(page.id);
    });

    // Attach Rotate click
    card.querySelector('.rotate-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      rotatePage(page.id);
    });

    // Attach Delete click
    card.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deletePage(page.id);
    });

    // Drag and drop event listeners
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);
    card.addEventListener('dragover', handleDragOver);
    card.addEventListener('dragenter', handleDragEnter);
    card.addEventListener('dragleave', handleDragLeave);
    card.addEventListener('drop', handleDrop);

    pagesGrid.appendChild(card);
  });

  lucide.createIcons();
}

// Asynchronously render PDF Page to Canvas and Cache it
async function renderPageThumbnail(pageItem, container) {
  try {
    const file = state.files.get(pageItem.fileId);
    if (!file) return;

    const pdfPage = await file.pdfjsDoc.getPage(pageItem.pageNumber);
    const nativeViewport = pdfPage.getViewport({ scale: 1.0 });
    pageItem.nativeW = nativeViewport.width;
    pageItem.nativeH = nativeViewport.height;

    // Set rendering scale
    // Standard viewport with rotation applied
    const viewport = pdfPage.getViewport({
      scale: 1.0,
      rotation: (pdfPage.rotate + pageItem.rotation) % 360
    });

    // Fit canvas in thumbnail box (max width: 180px, max height: 250px)
    const maxW = 180;
    const maxH = 250;
    const scale = Math.min(maxW / viewport.width, maxH / viewport.height);

    const thumbViewport = pdfPage.getViewport({
      scale: scale,
      rotation: (pdfPage.rotate + pageItem.rotation) % 360
    });

    const canvas = document.createElement('canvas');
    canvas.className = 'card-thumbnail';
    canvas.width = thumbViewport.width;
    canvas.height = thumbViewport.height;

    const renderContext = {
      canvasContext: canvas.getContext('2d'),
      viewport: thumbViewport
    };

    await pdfPage.render(renderContext).promise;

    // Draw annotations overlay on thumbnail if any
    if (pageItem.annotations) {
      const nativeViewport = pdfPage.getViewport({ scale: 1.0 });
      const nativeW = nativeViewport.width;
      const nativeH = nativeViewport.height;
      const overlayBlob = await generateOverlayPng(pageItem, nativeW, nativeH);
      const overlayUrl = URL.createObjectURL(overlayBlob);
      const img = new Image();
      await new Promise((resolveImg) => {
        img.onload = () => {
          const ctx = canvas.getContext('2d');
          ctx.save();
          // Apply PDFJS viewport transform (handles both native and workspace rotation)
          ctx.transform(...thumbViewport.transform);
          ctx.drawImage(img, 0, 0, nativeW, nativeH);
          ctx.restore();
          resolveImg();
        };
        img.onerror = resolveImg;
        img.src = overlayUrl;
      });
      URL.revokeObjectURL(overlayUrl);
    }

    // Cache the canvas element
    pageItem.renderedCanvas = canvas;

    // Clear and append
    container.innerHTML = '';
    container.appendChild(canvas);
  } catch (error) {
    console.error('Thumbnail render error:', error);
    container.innerHTML = '<span style="font-size:11px;color:var(--danger);padding:20px;">載入失敗</span>';
  }
}

// Drag & Drop Card Functions
function handleDragStart(e) {
  draggedCard = this;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', this.dataset.id);
  setTimeout(() => this.classList.add('dragging'), 0);
}

function handleDragEnd(e) {
  this.classList.remove('dragging');
  draggedCard = null;
  document.querySelectorAll('.page-card').forEach(card => card.classList.remove('drag-over'));
}

function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDragEnter(e) {
  if (this !== draggedCard) {
    this.classList.add('drag-over');
  }
}

function handleDragLeave(e) {
  this.classList.remove('drag-over');
}

function handleDrop(e) {
  e.stopPropagation();
  e.preventDefault();

  if (draggedCard && draggedCard !== this) {
    const dragId = draggedCard.dataset.id;
    const dropId = this.dataset.id;

    const dragIdx = state.pages.findIndex(p => p.id === dragId);
    const dropIdx = state.pages.findIndex(p => p.id === dropId);

    if (dragIdx !== -1 && dropIdx !== -1) {
      // Move in pages array
      const [draggedPage] = state.pages.splice(dragIdx, 1);
      state.pages.splice(dropIdx, 0, draggedPage);

      // Fast re-render
      renderGrid();
    }
  }
  return false;
}

// Adjust Zoom / Size of page grid items
function adjustZoom(direction) {
  const zooms = ['small', 'medium', 'large'];
  const labels = { small: '小', medium: '中', large: '大' };

  let currentIndex = zooms.indexOf(state.zoomLevel);
  let newIndex = currentIndex + direction;

  if (newIndex >= 0 && newIndex < zooms.length) {
    pagesGrid.classList.remove(`zoom-${state.zoomLevel}`);
    state.zoomLevel = zooms[newIndex];
    pagesGrid.classList.add(`zoom-${state.zoomLevel}`);
    zoomLabel.innerText = labels[state.zoomLevel];
  }
}

// Individual Card Operations
function rotatePage(pageId) {
  const page = state.pages.find(p => p.id === pageId);
  if (page) {
    page.rotation = (page.rotation + 90) % 360;
    page.renderedCanvas = null; // Clear cache to force re-render
    renderGrid();
  }
}

function deletePage(pageId) {
  const index = state.pages.findIndex(p => p.id === pageId);
  if (index !== -1) {
    state.pages.splice(index, 1);
    showToast('頁面已刪除。', 'success');
    updateUI();
  }
}

function removeFile(fileId) {
  // Remove file details
  state.files.delete(fileId);
  // Remove its pages
  state.pages = state.pages.filter(page => page.fileId !== fileId);

  showToast('已移除該檔案及其所有頁面。', 'success');
  updateUI();
}

function clearAll() {
  state.files.clear();
  state.pages = [];
  showToast('所有檔案與頁面已清空。', 'success');
  updateUI();
}

// Selection & Batch Operations
function togglePageSelection(pageId) {
  const page = state.pages.find(p => p.id === pageId);
  if (page) {
    page.selected = !page.selected;

    // Toggle DOM class immediately for fast feedback
    const card = document.querySelector(`.page-card[data-id="${pageId}"]`);
    if (card) {
      card.classList.toggle('selected', page.selected);
    }

    updateSidebarControls();
  }
}

function toggleAllSelection(select) {
  state.pages.forEach(p => p.selected = select);

  // Update UI classes
  document.querySelectorAll('.page-card').forEach(card => {
    card.classList.toggle('selected', select);
  });

  updateSidebarControls();
}

function updateSidebarControls() {
  const selected = state.pages.filter(p => p.selected);
  const count = selected.length;

  if (count > 0) {
    batchActionsPanel.style.display = 'flex';
    selectedCount.innerText = count;
  } else {
    batchActionsPanel.style.display = 'none';
  }

  // Update export buttons disabled state
  const hasPages = state.pages.length > 0;
  exportMergedBtn.disabled = !hasPages;
  exportSplitBtn.disabled = !hasPages;
}

function handleBatchRotate() {
  const selected = state.pages.filter(p => p.selected);
  if (selected.length === 0) return;

  selected.forEach(page => {
    page.rotation = (page.rotation + 90) % 360;
    page.renderedCanvas = null; // Clear cache
  });

  showToast(`已批次旋轉 ${selected.length} 個頁面。`, 'success');
  renderGrid();
}

function handleBatchDelete() {
  const selected = state.pages.filter(p => p.selected);
  if (selected.length === 0) return;

  state.pages = state.pages.filter(p => !p.selected);
  showToast(`已批次刪除 ${selected.length} 個頁面。`, 'success');
  updateUI();
}

// Render a single page from PDF.js into a high-resolution PNG blob.
// This flattens all PDF content (including form fields) into pixels,
// ensuring NO form field borders survive into the exported PDF.
async function renderPageToPngBlob(pageItem, targetW, targetH) {
  const file = state.files.get(pageItem.fileId);
  if (!file) throw new Error('File not found for rendering');

  const pdfPage = await file.pdfjsDoc.getPage(pageItem.pageNumber);
  const totalRotation = (pdfPage.rotate + pageItem.rotation) % 360;
  const nativeViewport = pdfPage.getViewport({ scale: 1.0, rotation: totalRotation });

  // Scale so the canvas matches the PDF native dimensions at high DPI
  const scale = Math.max(targetW / nativeViewport.width, targetH / nativeViewport.height);
  const renderViewport = pdfPage.getViewport({ scale, rotation: totalRotation });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(renderViewport.width);
  canvas.height = Math.round(renderViewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await pdfPage.render({ canvasContext: ctx, viewport: renderViewport }).promise;

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')), 'image/png');
  });
}

// Compose flat page PNG + annotations overlay into a single PNG blob.
async function composeFlatPageBlob(pageItem, nativeW, nativeH) {
  // Use 3x scale for crisp, high-DPI export quality
  const EXPORT_SCALE = 3;
  const pixelW = Math.round(nativeW * EXPORT_SCALE);
  const pixelH = Math.round(nativeH * EXPORT_SCALE);

  // 1. Render the PDF page at high DPI (flat pixels, no form field structures)
  const pageBlob = await renderPageToPngBlob(pageItem, pixelW, pixelH);

  // 2. If no annotations, just return the high-DPI page directly
  if (!pageItem.annotations) return pageBlob;

  // 3. Build a combined canvas at 3x resolution
  const canvas = document.createElement('canvas');
  canvas.width = pixelW;
  canvas.height = pixelH;
  const ctx = canvas.getContext('2d');

  // Draw the flat page at full pixel dimensions
  const pageUrl = URL.createObjectURL(pageBlob);
  await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, 0, 0, pixelW, pixelH); URL.revokeObjectURL(pageUrl); resolve(); };
    img.onerror = () => { URL.revokeObjectURL(pageUrl); reject(new Error('Page image failed')); };
    img.src = pageUrl;
  });

  // Draw the annotations overlay (generateOverlayPng already outputs at 3x internally)
  const overlayBlob = await generateOverlayPng(pageItem, nativeW, nativeH);
  const overlayUrl = URL.createObjectURL(overlayBlob);
  await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, 0, 0, pixelW, pixelH); URL.revokeObjectURL(overlayUrl); resolve(); };
    img.onerror = () => { URL.revokeObjectURL(overlayUrl); reject(new Error('Overlay image failed')); };
    img.src = overlayUrl;
  });

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')), 'image/png');
  });
}

// PDF Exporting: Merge PDF
async function exportMergedPDF() {
  if (state.pages.length === 0) return;

  showLoading(true, '正在合成合併的 PDF，請稍候...');

  try {
    const mergedPdf = await PDFLib.PDFDocument.create();

    for (const pageItem of state.pages) {
      const file = state.files.get(pageItem.fileId);
      const pdfjsPage = await file.pdfjsDoc.getPage(pageItem.pageNumber);
      const totalRotation = (pdfjsPage.rotate + pageItem.rotation) % 360;
      const nativeVp = pdfjsPage.getViewport({ scale: 1.0, rotation: totalRotation });
      const nativeW = Math.round(nativeVp.width);
      const nativeH = Math.round(nativeVp.height);

      // Render page + overlay as a single flat PNG
      const flatBlob = await composeFlatPageBlob(pageItem, nativeW, nativeH);
      const flatBytes = new Uint8Array(await flatBlob.arrayBuffer());

      const pngImage = await mergedPdf.embedPng(flatBytes);
      const newPage = mergedPdf.addPage([nativeW, nativeH]);
      newPage.drawImage(pngImage, { x: 0, y: 0, width: nativeW, height: nativeH });
    }

    const pdfBytes = await mergedPdf.save();

    // Download PDF
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pdf_secretary_merged.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('合併 PDF 下載成功！', 'success');
  } catch (error) {
    console.error(error);
    showToast('合併 PDF 失敗，請重試。', 'error');
  } finally {
    showLoading(false);
  }
}

// PDF Exporting: Split PDF into ZIP
async function exportSplitPDF() {
  if (state.pages.length === 0) return;

  showLoading(true, '正在分割並封裝 PDF，請稍候...');

  try {
    const zip = new JSZip();

    for (let i = 0; i < state.pages.length; i++) {
      const pageItem = state.pages[i];
      const file = state.files.get(pageItem.fileId);
      const pdfjsPage = await file.pdfjsDoc.getPage(pageItem.pageNumber);
      const totalRotation = (pdfjsPage.rotate + pageItem.rotation) % 360;
      const nativeVp = pdfjsPage.getViewport({ scale: 1.0, rotation: totalRotation });
      const nativeW = Math.round(nativeVp.width);
      const nativeH = Math.round(nativeVp.height);

      // Render page + overlay as a single flat PNG
      const flatBlob = await composeFlatPageBlob(pageItem, nativeW, nativeH);
      const flatBytes = new Uint8Array(await flatBlob.arrayBuffer());

      const singlePageDoc = await PDFLib.PDFDocument.create();
      const pngImage = await singlePageDoc.embedPng(flatBytes);
      const newPage = singlePageDoc.addPage([nativeW, nativeH]);
      newPage.drawImage(pngImage, { x: 0, y: 0, width: nativeW, height: nativeH });

      const pdfBytes = await singlePageDoc.save();

      // Formatting filename
      const cleanFileName = file.name.replace(/\.pdf$/i, '');
      const zipFileName = `${i + 1}_[${cleanFileName}]_page_${pageItem.pageNumber}.pdf`;
      zip.file(zipFileName, pdfBytes);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pdf_secretary_split.zip';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
    showToast('分割 PDF 封裝下載成功！', 'success');
  } catch (error) {
    console.error(error);
    showToast('分割 PDF 失敗，請重試。', 'error');
  } finally {
    showLoading(false);
  }
}

// ==========================================
// PDF PAGE EDITOR INTEGRATION & CORE CODE
// ==========================================

// Editor State variables
let activePageId = null;
let activeTool = 'select'; // 'select', 'draw', 'highlight', 'eraser', 'text', 'signature'
let drawColor = '#ef4444';
let drawSize = 5;
let highlightColor = '#fbbf24';
let highlightSize = 20;
let textColor = '#000000';
let textSize = 16;
let shapeColor = '#ef4444';
let shapeStrokeSize = 2;
let shapeFill = false;

// Drawing states
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let drawCanvas, drawCtx;
let overlayContainer;

// Drag & Resize states
let draggedElement = null;
let resizingElement = null;
let dragStartX = 0;
let dragStartY = 0;
let elementStartX = 0;
let elementStartY = 0;
let elementStartWidth = 0;
let elementStartHeight = 0;
let activeElement = null;

// Undo/Redo stacks
let undoStack = [];
let redoStack = [];

// Saved signatures
let savedSignatures = [];

// UI References
let editorModal, viewport, canvasWrapper, bgCanvas;
let undoBtn, redoBtn, saveBtn, cancelBtn;
let toolButtons = {};
let propGroups = {};

// Editor Zoom state
let editorZoom = 1.0;

function adjustEditorZoom(direction) {
  if (direction > 0) {
    editorZoom = Math.min(3.0, editorZoom * 1.2);
  } else {
    editorZoom = Math.max(0.3, editorZoom / 1.2);
  }
  updateEditorZoom();
}

function updateEditorZoom() {
  if (!canvasWrapper || !viewport) return;
  canvasWrapper.style.transform = `scale(${editorZoom})`;
  canvasWrapper.style.transformOrigin = 'top left';

  const baseW = parseFloat(canvasWrapper.dataset.baseWidth) || canvasWrapper.clientWidth;
  const baseH = parseFloat(canvasWrapper.dataset.baseHeight) || canvasWrapper.clientHeight;

  const displayW = baseW * editorZoom;
  const displayH = baseH * editorZoom;

  const editorViewport = document.getElementById('editor-viewport');
  if (editorViewport) {
    editorViewport.style.width = `${displayW}px`;
    editorViewport.style.height = `${displayH}px`;
  }

  const label = document.getElementById('editor-zoom-label');
  if (label) {
    label.innerText = `${Math.round(editorZoom * 100)}%`;
  }
}

function initEditor() {
  editorModal = document.getElementById('pdf-editor-modal');
  viewport = document.querySelector('.editor-workspace');
  canvasWrapper = document.getElementById('editor-canvas-wrapper');
  bgCanvas = document.getElementById('editor-bg-canvas');
  drawCanvas = document.getElementById('editor-draw-canvas');
  drawCtx = drawCanvas.getContext('2d');
  overlayContainer = document.getElementById('editor-overlay-container');

  undoBtn = document.getElementById('editor-undo-btn');
  redoBtn = document.getElementById('editor-redo-btn');
  saveBtn = document.getElementById('editor-save-btn');
  cancelBtn = document.getElementById('editor-cancel-btn');

  // Editor zoom controls
  const editorZoomInBtn = document.getElementById('editor-zoom-in-btn');
  const editorZoomOutBtn = document.getElementById('editor-zoom-out-btn');
  const editorZoomFitBtn = document.getElementById('editor-zoom-fit-btn');

  if (editorZoomInBtn) editorZoomInBtn.addEventListener('click', () => adjustEditorZoom(1));
  if (editorZoomOutBtn) editorZoomOutBtn.addEventListener('click', () => adjustEditorZoom(-1));
  if (editorZoomFitBtn) editorZoomFitBtn.addEventListener('click', () => { editorZoom = 1.0; updateEditorZoom(); });

  // Toolbar buttons mapping
  const tools = ['select', 'draw', 'highlight', 'eraser', 'text', 'shape-rect', 'shape-circle', 'signature'];
  tools.forEach(t => {
    toolButtons[t] = document.getElementById(`tool-${t}`);
    if (toolButtons[t]) {
      toolButtons[t].addEventListener('click', () => setTool(t));
    }
  });

  // Property groups mapping
  const groups = ['drawing', 'text', 'shape', 'signature', 'select-hint'];
  groups.forEach(g => {
    propGroups[g] = document.getElementById(`prop-${g}-group`);
  });

  // Load saved signatures
  savedSignatures = JSON.parse(localStorage.getItem('pdf_secretary_signatures') || '[]');

  // Hook up actions
  cancelBtn.addEventListener('click', closeEditor);
  saveBtn.addEventListener('click', saveEditorChanges);
  undoBtn.addEventListener('click', handleUndo);
  redoBtn.addEventListener('click', handleRedo);

  // Keyboard listeners
  document.addEventListener('keydown', handleEditorKeyboardShortcuts);

  // Properties, Palette and Canvas setup
  setupColorPalettes();
  setupPropertyControls();
  setupDrawCanvasEvents();
  initSignaturePad();

  // Deselect when clicking empty workspace
  viewport.addEventListener('mousedown', (e) => {
    if (e.target.closest('.editor-element')) {
      return;
    }
    if (e.target.closest('.editor-sidebar') || e.target.closest('.editor-toolbar') || e.target.closest('.editor-header') || e.target.closest('.sig-dialog-card')) {
      return;
    }
    deselectAllElements();
  });

  // Panning functionality for select mode on empty space
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartScrollLeft = 0;
  let panStartScrollTop = 0;

  viewport.addEventListener('mousedown', (e) => {
    // Only pan in select mode, left click, and clicking on empty space
    if (activeTool !== 'select' || e.button !== 0) return;
    if (e.target.closest('.editor-element') || e.target.closest('.toolbar-btn') || e.target.closest('.editor-sidebar') || e.target.closest('.editor-header') || e.target.closest('.sig-dialog-card')) {
      return;
    }

    isPanning = true;
    viewport.classList.add('grabbing');
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartScrollLeft = viewport.scrollLeft;
    panStartScrollTop = viewport.scrollTop;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    viewport.scrollLeft = panStartScrollLeft - dx;
    viewport.scrollTop = panStartScrollTop - dy;
  });

  window.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      viewport.classList.remove('grabbing');
    }
  });
}

function handleEditorKeyboardShortcuts(e) {
  if (!editorModal || editorModal.style.display === 'none') return;

  const isTyping = document.activeElement && document.activeElement.tagName === 'TEXTAREA';

  if (e.ctrlKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    handleUndo();
  } else if (e.ctrlKey && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    handleRedo();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (activeElement) {
      deselectAllElements();
    } else {
      closeEditor();
    }
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isTyping && activeElement) {
    e.preventDefault();
    saveHistoryState();

    if (activeElement.dataset.originalSpanId) {
      const originalSpan = document.getElementById(activeElement.dataset.originalSpanId);
      if (originalSpan) {
        originalSpan.style.display = 'block';
      }
    }

    activeElement.remove();
    deselectAllElements();
    saveHistoryState();
  } else if (!isTyping) {
    if (activeElement && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      saveHistoryState();

      const step = e.shiftKey ? 5 : 1;
      const left = parseFloat(activeElement.style.left) || 0;
      const top = parseFloat(activeElement.style.top) || 0;

      const parent = overlayContainer.getBoundingClientRect();
      const child = activeElement.getBoundingClientRect();

      let newLeft = left;
      let newTop = top;

      if (e.key === 'ArrowUp') newTop = Math.max(0, top - step);
      if (e.key === 'ArrowDown') newTop = Math.min(parent.height - child.height, top + step);
      if (e.key === 'ArrowLeft') newLeft = Math.max(0, left - step);
      if (e.key === 'ArrowRight') newLeft = Math.min(parent.width - child.width, left + step);

      activeElement.style.left = `${newLeft}px`;
      activeElement.style.top = `${newTop}px`;
      delete activeElement.dataset.origX;
      delete activeElement.dataset.origY;

      saveHistoryState();
      return;
    }

    switch (e.key.toLowerCase()) {
      case 'v': setTool('select'); break;
      case 'p': setTool('draw'); break;
      case 'h': setTool('highlight'); break;
      case 'e': setTool('eraser'); break;
      case 't':
        setTool('text');
        break;
      case 's': setTool('signature'); break;
    }
  }
}

function getOverlayCenterRatios() {
  return { x: 0.375, y: 0.4 };
}

function getEditorDimensions() {
  const w = canvasWrapper.clientWidth || parseFloat(canvasWrapper.style.width) || 800;
  const h = canvasWrapper.clientHeight || parseFloat(canvasWrapper.style.height) || 1100;
  return { w, h };
}

function setupColorPalettes() {
  const drawColors = ['#ef4444', '#3b82f6', '#10b981', '#fbbf24', '#000000', '#8b5cf6', '#f97316', '#6b7280', '#ffffff'];
  const textColors = ['#000000', '#ef4444', '#3b82f6', '#10b981', '#fbbf24', '#8b5cf6', '#ffffff'];
  const shapeColors = ['#ef4444', '#3b82f6', '#10b981', '#fbbf24', '#000000', '#8b5cf6', '#ffffff'];
  const textBgColors = ['transparent', '#ffffff', '#f3f4f6', '#fef08a', '#dbeafe', '#fee2e2'];

  renderPalette(document.getElementById('draw-color-palette'), drawColors, drawColor, (color) => {
    drawColor = color;
    if (activeElement && activeElement.classList.contains('editor-shape-item')) {
      saveHistoryState(); // Save old state
      activeElement.dataset.color = color;
      updateShapeSvg(activeElement);
    }
  });

  renderPalette(document.getElementById('text-color-palette'), textColors, textColor, (color) => {
    textColor = color;
    if (activeElement && activeElement.classList.contains('editor-text-item')) {
      saveHistoryState(); // Save old state
      activeElement.style.color = color;
    }
  });

  renderPalette(document.getElementById('text-bg-color-palette'), textBgColors, 'transparent', (color) => {
    if (activeElement && activeElement.classList.contains('editor-text-item')) {
      saveHistoryState(); // Save old state
      activeElement.style.backgroundColor = color;
    }
  });

  renderPalette(document.getElementById('shape-color-palette'), shapeColors, shapeColor, (color) => {
    shapeColor = color;
    if (activeElement && activeElement.classList.contains('editor-shape-item')) {
      saveHistoryState(); // Save old state
      activeElement.dataset.color = color;
      updateShapeSvg(activeElement);
    }
  });
}

function renderPalette(container, colorsList, activeColor, onSelect) {
  if (!container) return;
  container.innerHTML = '';
  colorsList.forEach(color => {
    const swatch = document.createElement('div');
    if (color === 'transparent') {
      swatch.className = `color-swatch transparent-swatch ${color === activeColor ? 'active' : ''}`;
    } else {
      swatch.className = `color-swatch ${color === activeColor ? 'active' : ''}`;
      swatch.style.backgroundColor = color;
    }
    if (color === '#ffffff') {
      swatch.style.border = '1px solid var(--border-color)';
    }
    swatch.addEventListener('click', () => {
      container.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      onSelect(color);
    });
    container.appendChild(swatch);
  });
}

function setupPropertyControls() {
  const drawSizeSlider = document.getElementById('draw-size');
  const drawSizeVal = document.getElementById('draw-size-val');
  if (drawSizeSlider) {
    drawSizeSlider.addEventListener('input', () => {
      drawSize = parseInt(drawSizeSlider.value);
      drawSizeVal.innerText = `${drawSize}px`;
      highlightSize = drawSize * 3;
    });
  }

  const textSizeSelect = document.getElementById('text-size');
  if (textSizeSelect) {
    textSizeSelect.addEventListener('change', () => {
      if (activeElement && activeElement.classList.contains('editor-text-item')) {
        saveHistoryState();
        textSize = parseInt(textSizeSelect.value);
        activeElement.style.fontSize = `${textSize}px`;
      }
    });
  }

  const textFontFamilySelect = document.getElementById('text-font-family');
  if (textFontFamilySelect) {
    textFontFamilySelect.addEventListener('change', () => {
      if (activeElement && activeElement.classList.contains('editor-text-item')) {
        saveHistoryState();
        const val = textFontFamilySelect.value;
        activeElement.dataset.fontFamily = val;

        let fam = '"Noto Sans TC", "Inter", sans-serif';
        if (val === 'serif') {
          fam = '"PMingLiU", "MingLiU", "Noto Serif TC", serif';
        } else if (val === 'kaiti') {
          fam = '"DFKai-SB", "BiauKai", "Noto Serif TC", serif';
        }
        activeElement.style.fontFamily = fam;
      }
    });
  }

  const shapeStrokeSlider = document.getElementById('shape-stroke-size');
  const shapeStrokeVal = document.getElementById('shape-stroke-size-val');
  if (shapeStrokeSlider) {
    // Save history once when user starts sliding border stroke size
    shapeStrokeSlider.addEventListener('mousedown', () => { if (activeElement) saveHistoryState(); });
    shapeStrokeSlider.addEventListener('touchstart', () => { if (activeElement) saveHistoryState(); });
    shapeStrokeSlider.addEventListener('input', () => {
      shapeStrokeSize = parseInt(shapeStrokeSlider.value);
      shapeStrokeVal.innerText = `${shapeStrokeSize}px`;
      if (activeElement && activeElement.classList.contains('editor-shape-item')) {
        activeElement.dataset.strokeWidth = shapeStrokeSize;
        updateShapeSvg(activeElement);
      }
    });
  }

  const shapeFillCheckbox = document.getElementById('shape-fill-checkbox');
  if (shapeFillCheckbox) {
    // Save history state once when clicked
    shapeFillCheckbox.addEventListener('click', () => { if (activeElement) saveHistoryState(); });
    shapeFillCheckbox.addEventListener('change', () => {
      shapeFill = shapeFillCheckbox.checked;
      if (activeElement && activeElement.classList.contains('editor-shape-item')) {
        activeElement.dataset.fill = shapeFill;
        updateShapeSvg(activeElement);
      }
    });
  }

  const addSigBtn = document.getElementById('add-new-sig-btn');
  if (addSigBtn) {
    addSigBtn.addEventListener('click', openSignatureDialog);
  }
}

function setTool(toolName) {
  activeTool = toolName;

  Object.keys(toolButtons).forEach(t => {
    if (toolButtons[t]) {
      toolButtons[t].classList.toggle('active', t === toolName);
    }
  });

  if (toolName === 'select') {
    viewport.classList.add('tool-select');
  } else {
    viewport.classList.remove('tool-select');
  }

  if (toolName === 'draw' || toolName === 'highlight') {
    drawCanvas.style.pointerEvents = 'auto';
    drawCanvas.style.cursor = 'crosshair';
  } else if (toolName === 'eraser') {
    drawCanvas.style.pointerEvents = 'auto';
    drawCanvas.style.cursor = 'cell';
  } else {
    drawCanvas.style.pointerEvents = 'none';
    drawCanvas.style.cursor = 'default';
  }

  const textLayer = document.getElementById('editor-text-layer');
  if (textLayer) {
    textLayer.classList.toggle('active-tool-select', toolName === 'select' || toolName === 'text');
  }

  deselectAllElements();
  updatePropertiesPanel();

  if (toolName === 'text') {
    const center = getOverlayCenterRatios();
    const page = state.pages.find(p => p.id === activePageId);
    const defaultFont = (page && page.detectedFont) ? page.detectedFont : 'sans-serif';
    // Default background of newly created text boxes to #ffffff (white)
    addTextBox('按此輸入文字...', center.x, center.y, 0.35, 0.08, textSize, textColor, '#ffffff', defaultFont);
    setTool('select');
  } else if (toolName === 'shape-rect') {
    const center = getOverlayCenterRatios();
    addShape('rect', center.x, center.y, 0.25, 0.18, shapeColor, shapeStrokeSize, shapeFill);
    setTool('select');
  } else if (toolName === 'shape-circle') {
    const center = getOverlayCenterRatios();
    addShape('circle', center.x, center.y, 0.25, 0.22, shapeColor, shapeStrokeSize, shapeFill);
    setTool('select');
  }
}

function updatePropertiesPanel() {
  Object.keys(propGroups).forEach(g => {
    if (propGroups[g]) propGroups[g].style.display = 'none';
  });

  if (activeElement) {
    if (activeElement.classList.contains('editor-text-item')) {
      if (propGroups['text']) propGroups['text'].style.display = 'flex';
      const fSize = parseInt(activeElement.style.fontSize) || 16;
      const selectEl = document.getElementById('text-size');
      if (selectEl) {
        selectEl.querySelectorAll('.temp-font-size-option').forEach(o => o.remove());
        selectEl.value = fSize;
        if (selectEl.value !== String(fSize)) {
          const opt = document.createElement('option');
          opt.value = fSize;
          opt.innerText = `${fSize}px`;
          opt.className = 'temp-font-size-option';
          selectEl.appendChild(opt);
          selectEl.value = fSize;
        }
      }
      const txtColor = rgbToHex(activeElement.style.color) || '#000000';
      updatePaletteActiveColor('text-color-palette', txtColor);
      const txtBgColor = activeElement.style.backgroundColor || 'transparent';
      updatePaletteActiveColor('text-bg-color-palette', txtBgColor);
      const txtFontFamily = activeElement.dataset.fontFamily || 'sans-serif';
      document.getElementById('text-font-family').value = txtFontFamily;
    } else if (activeElement.classList.contains('editor-shape-item')) {
      if (propGroups['shape']) propGroups['shape'].style.display = 'flex';
      const sWidth = parseInt(activeElement.dataset.strokeWidth) || 2;
      document.getElementById('shape-stroke-size').value = sWidth;
      document.getElementById('shape-stroke-size-val').innerText = `${sWidth}px`;
      document.getElementById('shape-fill-checkbox').checked = activeElement.dataset.fill === 'true';
      const sColor = activeElement.dataset.color || '#ef4444';
      updatePaletteActiveColor('shape-color-palette', sColor);
    } else if (activeElement.classList.contains('editor-signature-item')) {
      if (propGroups['signature']) propGroups['signature'].style.display = 'flex';
      renderSavedSignaturesList();
    }
  } else {
    if (activeTool === 'draw' || activeTool === 'highlight' || activeTool === 'eraser') {
      if (propGroups['drawing']) propGroups['drawing'].style.display = 'flex';
      updatePaletteActiveColor('draw-color-palette', drawColor);
    } else if (activeTool === 'signature') {
      if (propGroups['signature']) propGroups['signature'].style.display = 'flex';
      renderSavedSignaturesList();
    } else {
      if (propGroups['select-hint']) propGroups['select-hint'].style.display = 'block';
    }
  }
}

function updatePaletteActiveColor(paletteId, color) {
  const palette = document.getElementById(paletteId);
  if (!palette) return;

  let normalizedColor = color;
  if (!color || color === 'rgba(0, 0, 0, 0)' || color === 'transparent' || color === 'initial' || color === 'inherit') {
    normalizedColor = 'transparent';
  }

  palette.querySelectorAll('.color-swatch').forEach(swatch => {
    let isMatch = false;
    if (normalizedColor === 'transparent') {
      isMatch = swatch.classList.contains('transparent-swatch');
    } else {
      isMatch = swatch.style.backgroundColor === normalizedColor ||
        rgbToHex(swatch.style.backgroundColor) === normalizedColor ||
        swatch.style.backgroundColor.replace(/\s/g, '') === normalizedColor.replace(/\s/g, '');
    }
    swatch.classList.toggle('active', isMatch);
  });
}

function rgbToHex(rgb) {
  if (!rgb || !rgb.startsWith('rgb')) return rgb;
  const match = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)$/);
  if (!match) return rgb;
  return "#" +
    ("0" + parseInt(match[1]).toString(16)).slice(-2) +
    ("0" + parseInt(match[2]).toString(16)).slice(-2) +
    ("0" + parseInt(match[3]).toString(16)).slice(-2);
}

function makeElementInteractive(el) {
  el.addEventListener('mousedown', (e) => {
    if (e.target.closest('.element-delete-btn') || e.target.closest('.element-resize-handle')) {
      return;
    }

    selectElement(el);

    if (activeTool !== 'select') return;

    e.preventDefault();
    saveHistoryState(); // Save state BEFORE dragging!
    draggedElement = el;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    elementStartX = parseFloat(el.style.left) || 0;
    elementStartY = parseFloat(el.style.top) || 0;

    document.addEventListener('mousemove', handleElementDrag);
    document.addEventListener('mouseup', handleElementDragEnd);
  });

  const resizeHandle = el.querySelector('.element-resize-handle');
  if (resizeHandle) {
    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      saveHistoryState(); // Save state BEFORE resizing!
      resizingElement = el;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      elementStartWidth = parseFloat(el.style.width) || 100;
      elementStartHeight = parseFloat(el.style.height) || 50;

      document.addEventListener('mousemove', handleElementResize);
      document.addEventListener('mouseup', handleElementResizeEnd);
    });
  }

  const deleteBtn = el.querySelector('.element-delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      saveHistoryState(); // Save state BEFORE deleting!

      if (el.dataset.originalSpanId) {
        const originalSpan = document.getElementById(el.dataset.originalSpanId);
        if (originalSpan) {
          originalSpan.style.display = 'block';
        }
      }

      el.remove();
      deselectAllElements();
    });
  }

  if (el.classList.contains('editor-text-item')) {
    el.addEventListener('dblclick', () => {
      const ta = el.querySelector('textarea');
      if (ta) {
        saveHistoryState(); // Save state BEFORE text changes!
        ta.style.pointerEvents = 'auto';
        ta.focus();
        ta.select();

        ta.addEventListener('blur', function onBlur() {
          ta.style.pointerEvents = 'none';
          ta.removeEventListener('blur', onBlur);
        });
      }
    });
  }
}

function handleElementDrag(e) {
  if (!draggedElement) return;
  const dx = (e.clientX - dragStartX) / editorZoom;
  const dy = (e.clientY - dragStartY) / editorZoom;

  const { w, h } = getEditorDimensions();
  const elW = parseFloat(draggedElement.style.width) || 100;
  const elH = parseFloat(draggedElement.style.height) || 50;

  let newX = elementStartX + dx;
  let newY = elementStartY + dy;

  newX = Math.max(0, Math.min(newX, w - elW));
  newY = Math.max(0, Math.min(newY, h - elH));

  draggedElement.style.left = `${newX}px`;
  draggedElement.style.top = `${newY}px`;
}

function handleElementDragEnd() {
  if (draggedElement) {
    if (draggedElement.dataset.whiteoutX !== undefined && draggedElement.dataset.whiteoutX !== null) {
      const { w, h } = getEditorDimensions();
      const leftVal = parseFloat(draggedElement.style.left) || 0;
      const topVal = parseFloat(draggedElement.style.top) || 0;
      // Since whiteoutX/Y should match the visual bounds (newLeftVal = leftVal - 4, newTopVal = topVal - 2),
      // we need to set the whiteout coordinates to match the new top/left but padded.
      // Wait, let's keep the relative whiteout offset constant, or just shift it by the same amount the box moved!
      // The box moved by: (newX - elementStartX) / w.
      // So new whiteoutX is: original whiteoutX + (newX - elementStartX)/w.
      // Or simply: the whiteout region is exactly aligned with the original textbox position, but when we move it,
      // the original position is still what needs to be whited out!
      // Wait, the user said: "移動之後 原來位置有框 新的位置也有框 把框移除有這麼難嗎?"
      // Ah! Why is there a border at the original location, and a border at the new location?
      // 1. "原來位置有框" -> In the exported PDF, the original PDF form field border is still visible because it wasn't successfully whited out or removed!
      // Wait! Why wasn't the original form field border removed/whited out?
      // Because we deleted `/Annots` from copiedPage, but wait: is there a /Widget or /Annots in the parent page/catalog or inherited from somewhere else?
      // Or does the original form field border display because the whiteout rectangle did not cover it, or the whiteout was moved with the text box?
      // Let's think: if the user drags the textbox, the whiteout coordinates in the dataset (whiteoutX, whiteoutY, whiteoutW, whiteoutH) might have been updated,
      // or NOT updated?
      // If we UPDATE the whiteout coordinates when dragging, then the whiteout moves to the NEW location, meaning the ORIGINAL location is NO LONGER whited out!
      // Yes! If the user moves the textbox to a new position, the original text and its form field border are revealed again, because the whiteout moved!
      // But wait! We want the whiteout to STAY at the original location to erase the old text/border, AND the textbox at the new location should NOT have a whiteout?
      // Wait, if the textbox is at a new location, it is just new text. The original text at the original position must STILL be whited out!
      // So the whiteout coordinates MUST NOT move with the textbox! They must remain at the original text's coordinates to keep it covered!
      // Ah!!! If we deleted `draggedElement.dataset.origX; delete draggedElement.dataset.origY;` but left the whiteout coordinates UNTOUCHED,
      // then during export, `whiteoutX` is still the original coordinates, so it whites out the original location!
      // But wait! If `whiteoutX` remains at the original location, why does the user say "原來位置有框"?
      // Let's re-read carefully: "原來位置有框" (Original position has a box) and "新的位置也有框" (New position also has a box).
      // Why does the new position have a box?
      // Oh! When exporting, is there a box drawn around the text? No, `generateOverlayPng` only draws text and whiteout:
      // Wait! If the user drags a textbox, does it draw a box?
      // Let's look at `generateOverlayPng` text drawing:
      // "bgColor: el.style.backgroundColor"
      // Wait, when we created the textbox in renderOriginalTextLayer:
      // `addTextBoxInternal(..., fontSize, '#000000', '#ffffff', ...)`
      // Oh! The background color is set to `#ffffff` (white)!
      // But is there a border/box around the editor textbox?
      // Let's check `styles.css` to see the styling of `.editor-text-item`.
    }
    delete draggedElement.dataset.origX;
    delete draggedElement.dataset.origY;
    document.removeEventListener('mousemove', handleElementDrag);
    document.removeEventListener('mouseup', handleElementDragEnd);
    draggedElement = null;
  }
}

function handleElementResize(e) {
  if (!resizingElement) return;
  const dx = (e.clientX - dragStartX) / editorZoom;
  const dy = (e.clientY - dragStartY) / editorZoom;

  let newWidth = elementStartWidth + dx;
  let newHeight = elementStartHeight + dy;

  const minSize = 24;
  newWidth = Math.max(minSize, newWidth);
  newHeight = Math.max(minSize, newHeight);

  const { w, h } = getEditorDimensions();
  const left = parseFloat(resizingElement.style.left) || 0;
  const top = parseFloat(resizingElement.style.top) || 0;

  newWidth = Math.min(newWidth, w - left);
  newHeight = Math.min(newHeight, h - top);

  resizingElement.style.width = `${newWidth}px`;
  resizingElement.style.height = `${newHeight}px`;

  if (resizingElement.classList.contains('editor-shape-item')) {
    updateShapeSvg(resizingElement);
  }
}

function handleElementResizeEnd() {
  if (resizingElement) {
    delete resizingElement.dataset.origW;
    delete resizingElement.dataset.origH;
    document.removeEventListener('mousemove', handleElementResize);
    document.removeEventListener('mouseup', handleElementResizeEnd);
    resizingElement = null;
  }
}

function selectElement(el) {
  deselectAllElements();
  activeElement = el;
  el.classList.add('selected');
  updatePropertiesPanel();
}

function deselectAllElements() {
  if (activeElement) {
    activeElement.classList.remove('selected');
    activeElement = null;
  }
  updatePropertiesPanel();
}

function addTextBox(text = '雙擊編輯文字', leftPercent = 0.4, topPercent = 0.4, widthPercent = 0.25, heightPercent = 0.08, fontSize = 16, color = '#000000', bgColor = 'transparent', fontFamily = 'sans-serif', saveHistory = true, whiteoutX = null, whiteoutY = null, whiteoutW = null, whiteoutH = null) {
  if (saveHistory) saveHistoryState(); // Save state BEFORE adding textbox!

  const { w, h } = getEditorDimensions();
  const id = 'text-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now();

  addTextBoxInternal(id, text, `${leftPercent * w}px`, `${topPercent * h}px`, `${widthPercent * w}px`, `${heightPercent * h}px`, `${fontSize}px`, color, bgColor, fontFamily, whiteoutX, whiteoutY, whiteoutW, whiteoutH);

  const newEl = overlayContainer.querySelector(`[data-id="${id}"]`);
  if (newEl) selectElement(newEl);
  return newEl;
}

function addTextBoxInternal(id, text, left, top, width, height, fontSize, color, bgColor = 'transparent', fontFamily = 'sans-serif', whiteoutX = null, whiteoutY = null, whiteoutW = null, whiteoutH = null) {
  const el = document.createElement('div');
  el.className = 'editor-element editor-text-item';
  el.dataset.id = id;
  el.style.left = left;
  el.style.top = top;
  el.style.width = width;
  el.style.height = height;
  el.style.fontSize = fontSize;
  el.style.color = color;
  el.style.backgroundColor = bgColor;

  if (whiteoutX !== null && whiteoutX !== undefined) el.dataset.whiteoutX = whiteoutX;
  if (whiteoutY !== null && whiteoutY !== undefined) el.dataset.whiteoutY = whiteoutY;
  if (whiteoutW !== null && whiteoutW !== undefined) el.dataset.whiteoutW = whiteoutW;
  if (whiteoutH !== null && whiteoutH !== undefined) el.dataset.whiteoutH = whiteoutH;

  // Normalize keyword to ensure consistency (serif / kaiti / sans-serif)
  let fontKeyword = 'sans-serif';
  if (fontFamily === 'kaiti' || fontFamily.includes('DFKai-SB') || fontFamily.includes('BiauKai')) {
    fontKeyword = 'kaiti';
  } else if (fontFamily === 'serif' || fontFamily.includes('PMingLiU') || fontFamily.includes('MingLiU')) {
    fontKeyword = 'serif';
  }

  el.dataset.fontFamily = fontKeyword;

  let fontFam = '"Noto Sans TC", "Inter", sans-serif';
  if (fontKeyword === 'kaiti') {
    fontFam = '"DFKai-SB", "BiauKai", "Noto Serif TC", serif';
  } else if (fontKeyword === 'serif') {
    fontFam = '"PMingLiU", "MingLiU", "Noto Serif TC", serif';
  }
  el.style.fontFamily = fontFam;

  el.innerHTML = `
    <textarea style="pointer-events: none; border: none !important; outline: none !important; box-shadow: none !important; background: transparent !important; padding: 2px 4px; resize: none; overflow: hidden; width: 100%; height: 100%; display: block; box-sizing: border-box; margin: 0; font-family: inherit; font-size: inherit; color: inherit; line-height: 1.2;">${text}</textarea>
    <button class="element-delete-btn" title="刪除"><i data-lucide="x"></i></button>
    <div class="element-resize-handle"></div>
  `;

  overlayContainer.appendChild(el);
  lucide.createIcons();
  makeElementInteractive(el);
}

function addShape(type = 'rect', leftPercent = 0.4, topPercent = 0.4, widthPercent = 0.2, heightPercent = 0.15, color = '#ef4444', strokeWidth = 2, fill = false, saveHistory = true) {
  if (saveHistory) saveHistoryState(); // Save state BEFORE adding shape!

  const { w, h } = getEditorDimensions();
  const id = 'shape-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now();

  addShapeInternal(id, type, `${leftPercent * w}px`, `${topPercent * h}px`, `${widthPercent * w}px`, `${heightPercent * h}px`, color, fill, strokeWidth);

  const newEl = overlayContainer.querySelector(`[data-id="${id}"]`);
  if (newEl) selectElement(newEl);
}

function addShapeInternal(id, type, left, top, width, height, color, fill, strokeWidth) {
  const el = document.createElement('div');
  el.className = 'editor-element editor-shape-item';
  el.dataset.id = id;
  el.dataset.shapeType = type;
  el.dataset.color = color;
  el.dataset.fill = fill;
  el.dataset.strokeWidth = strokeWidth;
  el.style.left = left;
  el.style.top = top;
  el.style.width = width;
  el.style.height = height;

  updateShapeSvg(el);
  overlayContainer.appendChild(el);
  makeElementInteractive(el);
}

function updateShapeSvg(el) {
  const type = el.dataset.shapeType;
  const color = el.dataset.color;
  const fill = el.dataset.fill === 'true';
  const strokeWidth = parseInt(el.dataset.strokeWidth) || 2;
  const fillAttr = fill ? color : 'none';

  if (type === 'rect') {
    el.innerHTML = `
      <svg>
        <rect x="${strokeWidth / 2}" y="${strokeWidth / 2}" width="100%" height="100%" rx="2" ry="2" fill="${fillAttr}" stroke="${strokeWidth > 0 ? color : 'none'}" stroke-width="${strokeWidth}" style="width: calc(100% - ${strokeWidth}px); height: calc(100% - ${strokeWidth}px);" />
      </svg>
      <button class="element-delete-btn" title="刪除"><i data-lucide="x"></i></button>
      <div class="element-resize-handle"></div>
    `;
  } else if (type === 'circle') {
    el.innerHTML = `
      <svg>
        <ellipse cx="50%" cy="50%" rx="calc(50% - ${strokeWidth / 2}px)" ry="calc(50% - ${strokeWidth / 2}px)" fill="${fillAttr}" stroke="${strokeWidth > 0 ? color : 'none'}" stroke-width="${strokeWidth}" />
      </svg>
      <button class="element-delete-btn" title="刪除"><i data-lucide="x"></i></button>
      <div class="element-resize-handle"></div>
    `;
  }
  lucide.createIcons();
}

function addSignature(dataUrl, leftPercent = 0.4, topPercent = 0.4, widthPercent = 0.25, heightPercent = 0.12, saveHistory = true) {
  if (saveHistory) saveHistoryState(); // Save state BEFORE adding signature!

  const { w, h } = getEditorDimensions();
  const id = 'sig-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now();

  addSignatureInternal(id, dataUrl, `${leftPercent * w}px`, `${topPercent * h}px`, `${widthPercent * w}px`, `${heightPercent * h}px`);

  const newEl = overlayContainer.querySelector(`[data-id="${id}"]`);
  if (newEl) selectElement(newEl);
}

function addSignatureInternal(id, dataUrl, left, top, width, height) {
  const el = document.createElement('div');
  el.className = 'editor-element editor-signature-item';
  el.dataset.id = id;
  el.style.left = left;
  el.style.top = top;
  el.style.width = width;
  el.style.height = height;

  el.innerHTML = `
    <img src="${dataUrl}" />
    <button class="element-delete-btn" title="刪除"><i data-lucide="x"></i></button>
    <div class="element-resize-handle"></div>
  `;

  overlayContainer.appendChild(el);
  lucide.createIcons();
  makeElementInteractive(el);
}

function setupDrawCanvasEvents() {
  drawCanvas.addEventListener('mousedown', startDrawing);
  drawCanvas.addEventListener('mousemove', draw);
  drawCanvas.addEventListener('mouseup', stopDrawing);
  drawCanvas.addEventListener('mouseleave', stopDrawing);

  // Touch support for drawing
  drawCanvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = drawCanvas.getBoundingClientRect();
    const mouseEvent = new MouseEvent('mousedown', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    drawCanvas.dispatchEvent(mouseEvent);
  });

  drawCanvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = drawCanvas.getBoundingClientRect();
    const mouseEvent = new MouseEvent('mousemove', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    drawCanvas.dispatchEvent(mouseEvent);
  });

  drawCanvas.addEventListener('touchend', () => {
    const mouseEvent = new MouseEvent('mouseup', {});
    drawCanvas.dispatchEvent(mouseEvent);
  });
}

function startDrawing(e) {
  if (activeTool !== 'draw' && activeTool !== 'highlight' && activeTool !== 'eraser') return;

  saveHistoryState(); // Save state BEFORE drawing stroke!
  isDrawing = true;

  const rect = drawCanvas.getBoundingClientRect();
  const clientX = e.clientX || (e.touches && e.touches[0].clientX);
  const clientY = e.clientY || (e.touches && e.touches[0].clientY);

  const scaleX = drawCanvas.width / rect.width;
  const scaleY = drawCanvas.height / rect.height;

  lastX = (clientX - rect.left) * scaleX;
  lastY = (clientY - rect.top) * scaleY;

  drawCtx.beginPath();
  drawCtx.moveTo(lastX, lastY);
}

function draw(e) {
  if (!isDrawing) return;

  const rect = drawCanvas.getBoundingClientRect();
  const clientX = e.clientX || (e.touches && e.touches[0].clientX);
  const clientY = e.clientY || (e.touches && e.touches[0].clientY);

  const scaleX = drawCanvas.width / rect.width;
  const scaleY = drawCanvas.height / rect.height;

  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;

  drawCtx.beginPath();
  drawCtx.moveTo(lastX, lastY);
  drawCtx.lineTo(x, y);

  if (activeTool === 'eraser') {
    drawCtx.globalCompositeOperation = 'destination-out';
    drawCtx.lineWidth = 20;
    drawCtx.strokeStyle = 'rgba(0,0,0,1)';
  } else if (activeTool === 'highlight') {
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.lineWidth = highlightSize;
    drawCtx.strokeStyle = hexToRgba(drawColor, 0.4);
  } else {
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.lineWidth = drawSize;
    drawCtx.strokeStyle = drawColor;
  }

  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';
  drawCtx.stroke();

  lastX = x;
  lastY = y;
}

function stopDrawing() {
  if (isDrawing) {
    isDrawing = false;
  }
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Signature Pad functions
let isSigning = false;
let sigCanvas, sigCtx;

function initSignaturePad() {
  sigCanvas = document.getElementById('signature-pad-canvas');
  sigCtx = sigCanvas.getContext('2d');

  sigCanvas.addEventListener('mousedown', startSigning);
  sigCanvas.addEventListener('mousemove', sign);
  sigCanvas.addEventListener('mouseup', stopSigning);
  sigCanvas.addEventListener('mouseleave', stopSigning);

  sigCanvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousedown', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    sigCanvas.dispatchEvent(mouseEvent);
  });

  sigCanvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousemove', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    sigCanvas.dispatchEvent(mouseEvent);
  });

  sigCanvas.addEventListener('touchend', () => {
    const mouseEvent = new MouseEvent('mouseup', {});
    sigCanvas.dispatchEvent(mouseEvent);
  });

  document.getElementById('sig-clear-btn').addEventListener('click', clearSignaturePad);
  document.getElementById('sig-close-btn').addEventListener('click', closeSignatureDialog);
  document.getElementById('sig-insert-btn').addEventListener('click', insertSignature);
}

function resizeSignaturePad() {
  const rect = sigCanvas.getBoundingClientRect();
  sigCanvas.width = rect.width * 2;
  sigCanvas.height = rect.height * 2;
  sigCtx.scale(2, 2);

  sigCtx.strokeStyle = '#000000';
  sigCtx.lineWidth = 3;
  sigCtx.lineCap = 'round';
  sigCtx.lineJoin = 'round';
}

function startSigning(e) {
  isSigning = true;
  const rect = sigCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  sigCtx.beginPath();
  sigCtx.moveTo(x, y);
}

function sign(e) {
  if (!isSigning) return;
  const rect = sigCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  sigCtx.lineTo(x, y);
  sigCtx.stroke();
  document.getElementById('sig-insert-btn').disabled = false;
}

function stopSigning() {
  isSigning = false;
}

function clearSignaturePad() {
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  document.getElementById('sig-insert-btn').disabled = true;
}

function closeSignatureDialog() {
  document.getElementById('signature-dialog').style.display = 'none';
}

function openSignatureDialog() {
  document.getElementById('signature-dialog').style.display = 'flex';
  setTimeout(resizeSignaturePad, 100);
}

function insertSignature() {
  const croppedDataUrl = getCroppedCanvasDataUrl(sigCanvas);
  if (croppedDataUrl) {
    savedSignatures.push(croppedDataUrl);
    if (savedSignatures.length > 5) savedSignatures.shift();
    localStorage.setItem('pdf_secretary_signatures', JSON.stringify(savedSignatures));

    const center = getOverlayCenterRatios();
    addSignature(croppedDataUrl, center.x, center.y, 0.28, 0.14);
    setTool('select');
  }
  closeSignatureDialog();
}

function getCroppedCanvasDataUrl(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  let minX = w, maxX = 0, minY = h, maxY = 0;
  let found = false;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const alpha = data[idx + 3];
      if (alpha > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }

  if (!found) return null;

  const pad = 12;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w, maxX + pad);
  maxY = Math.min(h, maxY + pad);

  const cropW = maxX - minX;
  const cropH = maxY - minY;

  const temp = document.createElement('canvas');
  temp.width = cropW;
  temp.height = cropH;
  const tempCtx = temp.getContext('2d');
  tempCtx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

  return temp.toDataURL();
}

// Undo/Redo logic
function serializeEditorState() {
  const { w, h } = getEditorDimensions();

  return {
    drawingsDataUrl: isCanvasBlank(drawCanvas) ? null : drawCanvas.toDataURL(),
    texts: Array.from(overlayContainer.querySelectorAll('.editor-text-item')).map(el => ({
      id: el.dataset.id,
      text: el.querySelector('textarea').value,
      left: el.style.left,
      top: el.style.top,
      width: el.style.width,
      height: el.style.height,
      fontSize: el.style.fontSize,
      color: el.style.color,
      bgColor: el.style.backgroundColor || 'transparent',
      fontFamily: el.dataset.fontFamily || 'sans-serif',
      whiteoutX: el.dataset.whiteoutX || null,
      whiteoutY: el.dataset.whiteoutY || null,
      whiteoutW: el.dataset.whiteoutW || null,
      whiteoutH: el.dataset.whiteoutH || null
    })),
    signatures: Array.from(overlayContainer.querySelectorAll('.editor-signature-item')).map(el => ({
      id: el.dataset.id,
      dataUrl: el.querySelector('img').src,
      left: el.style.left,
      top: el.style.top,
      width: el.style.width,
      height: el.style.height
    })),
    shapes: Array.from(overlayContainer.querySelectorAll('.editor-shape-item')).map(el => ({
      id: el.dataset.id,
      type: el.dataset.shapeType,
      left: el.style.left,
      top: el.style.top,
      width: el.style.width,
      height: el.style.height,
      color: el.dataset.color,
      fill: el.dataset.fill === 'true',
      strokeWidth: el.dataset.strokeWidth
    }))
  };
}

function restoreEditorState(snap) {
  overlayContainer.innerHTML = '';
  deselectAllElements();

  if (snap.texts) {
    snap.texts.forEach(t => {
      addTextBoxInternal(t.id, t.text, t.left, t.top, t.width, t.height, t.fontSize, t.color, t.bgColor || 'transparent', t.fontFamily || 'sans-serif', t.whiteoutX, t.whiteoutY, t.whiteoutW, t.whiteoutH);
    });
  }

  if (snap.shapes) {
    snap.shapes.forEach(s => {
      addShapeInternal(s.id, s.type, s.left, s.top, s.width, s.height, s.color, s.fill, s.strokeWidth);
    });
  }

  if (snap.signatures) {
    snap.signatures.forEach(sig => {
      addSignatureInternal(sig.id, sig.dataUrl, sig.left, sig.top, sig.width, sig.height);
    });
  }

  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  if (snap.drawingsDataUrl) {
    const img = new Image();
    img.onload = () => {
      drawCtx.drawImage(img, 0, 0, drawCanvas.width, drawCanvas.height);
    };
    img.src = snap.drawingsDataUrl;
  }

  lucide.createIcons();
}

function saveHistoryState() {
  const snap = serializeEditorState();
  if (undoStack.length > 50) undoStack.shift();
  undoStack.push(snap);
  redoStack = [];
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

function handleUndo() {
  if (undoStack.length === 0) return;
  const current = serializeEditorState();
  redoStack.push(current);
  const prev = undoStack.pop();
  restoreEditorState(prev);
  updateUndoRedoButtons();
}

function handleRedo() {
  if (redoStack.length === 0) return;
  const next = redoStack.pop();
  undoStack.push(serializeEditorState());
  restoreEditorState(next);
  updateUndoRedoButtons();
}

async function openEditor(pageId) {
  const page = state.pages.find(p => p.id === pageId);
  if (!page) return;
  const file = state.files.get(page.fileId);
  if (!file) return;

  activePageId = pageId;
  showLoading(true, '正在載入頁面編輯器...');

  try {
    const pdfPage = await file.pdfjsDoc.getPage(page.pageNumber);
    const viewportObj = pdfPage.getViewport({ scale: 2.0 });
    const nativeViewport = pdfPage.getViewport({ scale: 1.0 });
    page.nativeW = nativeViewport.width;
    page.nativeH = nativeViewport.height;

    const availableWidth = Math.min(800, window.innerWidth - 420);
    const displayScale = availableWidth / viewportObj.width;
    const displayWidth = viewportObj.width * displayScale;
    const displayHeight = viewportObj.height * displayScale;

    canvasWrapper.style.width = `${displayWidth}px`;
    canvasWrapper.style.height = `${displayHeight}px`;
    canvasWrapper.dataset.baseWidth = displayWidth;
    canvasWrapper.dataset.baseHeight = displayHeight;

    // Reset editor zoom to default fit page
    editorZoom = 1.0;
    updateEditorZoom();

    bgCanvas.width = viewportObj.width;
    bgCanvas.height = viewportObj.height;
    drawCanvas.width = viewportObj.width;
    drawCanvas.height = viewportObj.height;

    const renderContext = {
      canvasContext: bgCanvas.getContext('2d'),
      viewport: viewportObj
    };
    await pdfPage.render(renderContext).promise;

    overlayContainer.innerHTML = '';
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

    // Clear and build the original text layer
    const textLayerContainer = document.getElementById('editor-text-layer');
    if (textLayerContainer) {
      textLayerContainer.innerHTML = '';
      // Asynchronously load and render original text spans
      renderOriginalTextLayer(pdfPage, viewportObj, displayScale, textLayerContainer);
    }

    undoStack = [];
    redoStack = [];
    updateUndoRedoButtons();

    if (page.annotations) {
      if (page.annotations.drawingsDataUrl) {
        const img = new Image();
        img.onload = () => {
          drawCtx.drawImage(img, 0, 0, drawCanvas.width, drawCanvas.height);
        };
        img.src = page.annotations.drawingsDataUrl;
      }

      const w = displayWidth;
      const h = displayHeight;

      if (page.annotations.texts) {
        page.annotations.texts.forEach(t => {
          const totalScale = page.nativeW ? (w / page.nativeW) : 1;
          const screenFontSize = t.fontSize * totalScale;
          addTextBox(t.text, t.x, t.y, t.width, t.height, screenFontSize, t.color, t.bgColor || 'transparent', t.fontFamily || 'sans-serif', false, t.whiteoutX, t.whiteoutY, t.whiteoutW, t.whiteoutH);

          // If this text item has whiteout coords, paint a white rect on bgCanvas
          // so the original PDF text is visually erased in the editor too.
          if (t.whiteoutX !== null && t.whiteoutX !== undefined && bgCanvas) {
            const bgCtx = bgCanvas.getContext('2d');
            const scaleX = bgCanvas.width / w;
            const scaleY = bgCanvas.height / h;
            bgCtx.fillStyle = '#ffffff';
            bgCtx.fillRect(
              t.whiteoutX * w * scaleX - 1,
              t.whiteoutY * h * scaleY - 1,
              t.whiteoutW * w * scaleX + 2,
              t.whiteoutH * h * scaleY + 2
            );
          }
        });
      }
      if (page.annotations.shapes) {
        page.annotations.shapes.forEach(s => {
          addShape(s.type, s.x, s.y, s.width, s.height, s.color, s.strokeWidth, s.fill, false);
        });
      }
      if (page.annotations.signatures) {
        page.annotations.signatures.forEach(sig => {
          addSignature(sig.dataUrl, sig.x, sig.y, sig.width, sig.height, false);
        });
      }
    }

    deselectAllElements();
    document.getElementById('editor-filename').innerText = file.name;
    const pageIndex = state.pages.findIndex(p => p.id === pageId);
    document.getElementById('editor-page-index').innerText = `頁面資訊: 第 ${pageIndex + 1} 頁`;

    editorModal.style.display = 'block';
    setTool('select');
  } catch (err) {
    console.error(err);
    showToast('開啟編輯器失敗，請重新嘗試。', 'error');
  } finally {
    showLoading(false);
  }
}

function closeEditor() {
  editorModal.style.display = 'none';
  activePageId = null;
}

function saveEditorChanges() {
  const page = state.pages.find(p => p.id === activePageId);
  if (!page) return;

  const { w, h } = getEditorDimensions();
  const totalScale = page.nativeW ? (w / page.nativeW) : 1;

  page.annotations = {
    editorWidth: w,
    editorHeight: h,
    texts: Array.from(overlayContainer.querySelectorAll('.editor-text-item')).map(el => ({
      text: el.querySelector('textarea').value,
      x: parseFloat(el.style.left) / w,
      y: parseFloat(el.style.top) / h,
      width: parseFloat(el.style.width) / w,
      height: parseFloat(el.style.height) / h,
      fontSize: (parseFloat(el.style.fontSize) || 16) / totalScale,
      color: el.style.color || '#000000',
      bgColor: el.style.backgroundColor || 'transparent',
      fontFamily: el.dataset.fontFamily || 'sans-serif',
      whiteoutX: el.dataset.whiteoutX ? parseFloat(el.dataset.whiteoutX) : null,
      whiteoutY: el.dataset.whiteoutY ? parseFloat(el.dataset.whiteoutY) : null,
      whiteoutW: el.dataset.whiteoutW ? parseFloat(el.dataset.whiteoutW) : null,
      whiteoutH: el.dataset.whiteoutH ? parseFloat(el.dataset.whiteoutH) : null
    })),
    signatures: Array.from(overlayContainer.querySelectorAll('.editor-signature-item')).map(el => ({
      dataUrl: el.querySelector('img').src,
      x: parseFloat(el.style.left) / w,
      y: parseFloat(el.style.top) / h,
      width: parseFloat(el.style.width) / w,
      height: parseFloat(el.style.height) / h
    })),
    shapes: Array.from(overlayContainer.querySelectorAll('.editor-shape-item')).map(el => ({
      type: el.dataset.shapeType,
      x: parseFloat(el.style.left) / w,
      y: parseFloat(el.style.top) / h,
      width: parseFloat(el.style.width) / w,
      height: parseFloat(el.style.height) / h,
      color: el.dataset.color || '#ef4444',
      fill: el.dataset.fill === 'true',
      strokeWidth: parseInt(el.dataset.strokeWidth) || 2
    })),
    drawingsDataUrl: isCanvasBlank(drawCanvas) ? null : drawCanvas.toDataURL()
  };

  page.renderedCanvas = null;
  showToast('頁面變更已暫存！', 'success');

  closeEditor();
  updateUI();
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, fontSize, fontFamily = 'sans-serif') {
  let fontFam = '"Noto Sans TC", "Inter", sans-serif';
  if (fontFamily.includes('kaiti') || fontFamily.includes('DFKai-SB') || fontFamily.includes('BiauKai')) {
    fontFam = '"DFKai-SB", "BiauKai", "Noto Serif TC", serif';
  } else if (fontFamily.includes('serif') || fontFamily.includes('PMingLiU') || fontFamily.includes('MingLiU')) {
    fontFam = '"PMingLiU", "MingLiU", "Noto Serif TC", serif';
  }
  ctx.font = `${fontSize}px ${fontFam}`;

  // Get scale factor from current transform to normalize measured text width
  const transform = ctx.getTransform ? ctx.getTransform() : null;
  const scaleX = transform ? Math.sqrt(transform.a * transform.a + transform.b * transform.b) : 1;

  const paragraphs = text.split('\n');
  let currentY = y;

  for (const para of paragraphs) {
    let currentLine = '';
    const tokens = [];
    let i = 0;
    while (i < para.length) {
      const code = para.charCodeAt(i);
      if (code > 255) {
        tokens.push(para[i]);
        i++;
      } else {
        let word = '';
        while (i < para.length && para.charCodeAt(i) <= 255 && para[i] !== ' ') {
          word += para[i];
          i++;
        }
        if (para[i] === ' ') {
          word += ' ';
          i++;
        }
        if (word) {
          tokens.push(word);
        }
      }
    }

    for (const token of tokens) {
      let testLine = currentLine + token;
      let metrics = ctx.measureText(testLine);
      const measuredWidth = metrics.width / scaleX;
      if (measuredWidth > maxWidth && currentLine !== '') {
        ctx.fillText(currentLine, x, currentY);
        currentLine = token;
        currentY += lineHeight;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine !== '') {
      ctx.fillText(currentLine, x, currentY);
      currentY += lineHeight;
    }
  }
}

function generateOverlayPng(pageItem, W, H) {
  return new Promise((resolve, reject) => {
    const scale = 3;
    const canvas = document.createElement('canvas');
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext('2d');

    ctx.scale(scale, scale);

    if (pageItem.annotations && pageItem.annotations.drawingsDataUrl) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, W, H);
        drawOtherAnnotations();
      };
      img.onerror = () => {
        drawOtherAnnotations();
      };
      img.src = pageItem.annotations.drawingsDataUrl;
    } else {
      drawOtherAnnotations();
    }

    async function drawOtherAnnotations() {
      // First, draw all whiteout rectangles to erase original texts/borders
      if (pageItem.annotations && pageItem.annotations.texts) {
        for (const textItem of pageItem.annotations.texts) {
          console.log('generateOverlayPng textItem:', textItem);
          if (textItem.whiteoutX !== null && textItem.whiteoutX !== undefined) {
            const wx = textItem.whiteoutX * W;
            const wy = textItem.whiteoutY * H;
            const ww = textItem.whiteoutW * W;
            const wh = textItem.whiteoutH * H;
            console.log('Drawing whiteout at:', wx, wy, ww, wh);
            ctx.save();
            ctx.fillStyle = '#ffffff'; // Whiteout background
            // Pad background by 3px to completely overlap form field borders underneath
            ctx.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
            ctx.restore();
          }
        }
      }

      if (pageItem.annotations && pageItem.annotations.shapes) {
        for (const shape of pageItem.annotations.shapes) {
          const sx = shape.x * W;
          const sy = shape.y * H;
          const sw = shape.width * W;
          const sh = shape.height * H;

          ctx.save();
          ctx.beginPath();
          ctx.strokeStyle = shape.color;
          ctx.lineWidth = shape.strokeWidth;

          const fillAttr = shape.fill;
          if (fillAttr) {
            ctx.fillStyle = shape.color;
          }

          if (shape.type === 'rect') {
            ctx.rect(sx, sy, sw, sh);
          } else if (shape.type === 'circle') {
            ctx.arc(sx + sw / 2, sy + sh / 2, Math.min(sw, sh) / 2, 0, 2 * Math.PI);
          }

          if (fillAttr) {
            ctx.fill();
          } else {
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      if (pageItem.annotations && pageItem.annotations.signatures) {
        for (const sig of pageItem.annotations.signatures) {
          const sx = sig.x * W;
          const sy = sig.y * H;
          const sw = sig.width * W;
          const sh = sig.height * H;

          await new Promise((resolveSig) => {
            const img = new Image();
            img.onload = () => {
              ctx.drawImage(img, sx, sy, sw, sh);
              resolveSig();
            };
            img.onerror = resolveSig;
            img.src = sig.dataUrl;
          });
        }
      }

      if (pageItem.annotations && pageItem.annotations.texts) {
        for (const textItem of pageItem.annotations.texts) {
          const tx = textItem.x * W;
          const ty = textItem.y * H;
          const tw = textItem.width * W;
          const th = textItem.height * H;

          const editorW = (pageItem.annotations && pageItem.annotations.editorWidth) || W;
          const editorScale = W / editorW;
          const paddingX = 4 * editorScale;
          const paddingY = 2 * editorScale;

          ctx.save();
          // Draw text box background if it is set and not transparent
          if (textItem.bgColor && textItem.bgColor !== 'transparent' && textItem.bgColor !== 'rgba(0, 0, 0, 0)') {
            ctx.fillStyle = textItem.bgColor;
            // Pad background by 1.5px to completely overlap subpixel lines/borders underneath
            ctx.fillRect(tx - 1.5, ty - 1.5, tw + 3, th + 3);
          }

          ctx.fillStyle = textItem.color;
          ctx.textBaseline = 'top';

          const fontSize = textItem.fontSize;
          const lineHeight = fontSize * 1.2;

          drawWrappedText(ctx, textItem.text, tx + paddingX, ty + paddingY, tw - (paddingX * 2), lineHeight, fontSize, textItem.fontFamily || 'sans-serif');
          ctx.restore();
        }
      }

      canvas.toBlob((blob) => {
        resolve(blob);
      }, 'image/png');
    }
  });
}

function detectFontFamily(pdfPage, style, fontName) {
  let realFontName = '';
  if (pdfPage && pdfPage.commonObjs) {
    const fObj = pdfPage.commonObjs.get(fontName);
    if (fObj && fObj.name) {
      realFontName = fObj.name;
    }
  }

  const name = ((fontName || '') + ' ' + (style?.fontFamily || '') + ' ' + realFontName).toLowerCase();
  if (name.includes('kai') || name.includes('biau') || name.includes('標楷') || name.includes('楷書') || name.includes('stdkai')) {
    return 'kaiti';
  }
  if ((name.includes('serif') && !name.includes('sans-serif')) || name.includes('ming') || name.includes('sung') || name.includes('song') || name.includes('simsun') || name.includes('細明') || name.includes('新細明') || name.includes('宋體') || name.includes('明體')) {
    return 'serif';
  }
  if (name.includes('hei') || name.includes('sans') || name.includes('gothic') || name.includes('arial') || name.includes('helvetica') || name.includes('黑體') || name.includes('微軟正黑') || name.includes('jheng')) {
    return 'sans-serif';
  }
  return 'sans-serif';
}

async function renderOriginalTextLayer(pdfPage, viewportObj, displayScale, container) {
  try {
    const textContent = await pdfPage.getTextContent();
    const nativeViewport = pdfPage.getViewport({ scale: 1.0 });

    // Detect the primary font family used on this page
    let kaitiCount = 0;
    let serifCount = 0;
    let sansCount = 0;

    textContent.items.forEach(item => {
      if (!item.str || item.str.trim() === '') return;
      const style = textContent.styles[item.fontName];
      const itemFontFamily = detectFontFamily(pdfPage, style, item.fontName);

      if (itemFontFamily === 'kaiti') {
        kaitiCount += item.str.length;
      } else if (itemFontFamily === 'serif') {
        serifCount += item.str.length;
      } else {
        sansCount += item.str.length;
      }
      item._normalizedFontFamily = itemFontFamily;
    });

    let detectedFont = 'sans-serif';
    if (kaitiCount >= serifCount && kaitiCount >= sansCount && kaitiCount > 0) {
      detectedFont = 'kaiti';
    } else if (serifCount >= kaitiCount && serifCount >= sansCount && serifCount > 0) {
      detectedFont = 'serif';
    }

    const page = state.pages.find(p => p.id === activePageId);
    if (page) {
      page.detectedFont = detectedFont;
    }

    textContent.items.forEach(item => {
      if (!item.str || item.str.trim() === '') return;

      const fontHeight = Math.abs(item.transform[3]);
      const scaleText = 2.0;
      const screenWidth = item.width * scaleText;
      const fontHeightScale = 1.25; // Increase height by 25% for padding
      const screenHeight = fontHeight * scaleText * fontHeightScale;

      const [px, py] = viewportObj.convertToViewportPoint(item.transform[4], item.transform[5]);

      const displayLeft = px * displayScale;
      // Shift displayTop down slightly to align the text box vertically (using 1.04 instead of 1.12)
      const displayTop = (py - fontHeight * scaleText * 1.04) * displayScale;
      const displayWidth = screenWidth * displayScale;
      const displayHeight = screenHeight * displayScale;

      const spanId = 'orig-span-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now();
      const span = document.createElement('div');
      span.id = spanId;
      span.className = 'original-text-span';
      span.style.left = `${displayLeft}px`;
      span.style.top = `${displayTop}px`;
      span.style.width = `${displayWidth}px`;
      span.style.height = `${displayHeight}px`;
      // Scale font size slightly down (by 0.88) to match the PDF text size perfectly
      span.style.fontSize = `${fontHeight * scaleText * displayScale * 0.88}px`;
      span.title = '點擊編輯此文字';

      span.dataset.text = item.str;
      span.dataset.x = px / viewportObj.width;
      span.dataset.y = (py - fontHeight * scaleText * 1.04) / viewportObj.height;
      span.dataset.width = screenWidth / viewportObj.width;
      span.dataset.height = screenHeight / viewportObj.height;
      span.dataset.fontSize = fontHeight * scaleText * displayScale * 0.88;
      // Attach the normalized font family detected for this text item
      span.dataset.fontFamily = item._normalizedFontFamily || 'sans-serif';

      span.addEventListener('click', (e) => {
        e.stopPropagation();

        saveHistoryState();

        const text = span.dataset.text;
        const leftVal = parseFloat(span.style.left) || 0;
        const topVal = parseFloat(span.style.top) || 0;
        const widthVal = parseFloat(span.style.width) || 0;
        const heightVal = parseFloat(span.style.height) || 0;

        const newLeftVal = leftVal - 4;
        const newTopVal = topVal - 2;
        const newWidthVal = widthVal + 8;
        const newHeightVal = heightVal + 4;

        const newTextBoxId = 'text-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now();

        // Determine which font family this original span used
        const spanFontFamily = span.dataset.fontFamily;
        const pageObj = state.pages.find(p => p.id === activePageId);
        const fallbackFont = (pageObj && pageObj.detectedFont) ? pageObj.detectedFont : 'sans-serif';
        const fontToUse = spanFontFamily || fallbackFont;

        // Create the editable textbox with appropriate styling
        const fontSize = `${parseFloat(span.style.fontSize) || 16}px`;
        addTextBoxInternal(newTextBoxId, text, `${newLeftVal}px`, `${newTopVal}px`, `${newWidthVal}px`, `${newHeightVal}px`, fontSize, '#000000', '#ffffff', fontToUse);
        const newEl = overlayContainer.querySelector(`[data-id="${newTextBoxId}"]`);
        const { w, h } = getEditorDimensions();
        if (newEl) {
          // Preserve original span reference
          newEl.dataset.originalSpanId = spanId;
          // Store whiteout coordinates (ratios) to erase the original text/border
          newEl.dataset.whiteoutX = newLeftVal / w;
          newEl.dataset.whiteoutY = newTopVal / h;
          newEl.dataset.whiteoutW = newWidthVal / w;
          newEl.dataset.whiteoutH = newHeightVal / h;
          selectElement(newEl);
        }

        span.style.display = 'none';

        // Visually erase the original text on the editor background canvas
        // bgCanvas is rendered by PDF.js at scale=2.0, so we must convert
        // display-space coordinates back to bgCanvas-space coordinates.
        if (bgCanvas) {
          const bgCtx = bgCanvas.getContext('2d');
          // bgCanvas dimensions vs display dimensions ratio
          const { w: displayW, h: displayH } = getEditorDimensions();
          const scaleX = bgCanvas.width / displayW;
          const scaleY = bgCanvas.height / displayH;
          bgCtx.fillStyle = '#ffffff';
          bgCtx.fillRect(
            newLeftVal * scaleX - 1,
            newTopVal * scaleY - 1,
            newWidthVal * scaleX + 2,
            newHeightVal * scaleY + 2
          );
        }

        saveHistoryState();

        showToast('已覆蓋原始文字並建立編輯框！', 'success');
      });

      container.appendChild(span);
    });
  } catch (err) {
    console.error('Error rendering text layer:', err);
  }
}

function isCanvasBlank(canvas) {
  const context = canvas.getContext('2d');
  const buffer = new Uint32Array(
    context.getImageData(0, 0, canvas.width, canvas.height).data.buffer
  );
  return !buffer.some(color => color !== 0);
}
