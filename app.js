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

// Load files into pdf-lib lazily
async function getPdfLibDoc(fileId) {
  const file = state.files.get(fileId);
  if (!file) throw new Error('File not found');
  
  if (!file.pdfLibDoc) {
    file.pdfLibDoc = await PDFLib.PDFDocument.load(file.bytes);
  }
  return file.pdfLibDoc;
}

// PDF Exporting: Merge PDF
async function exportMergedPDF() {
  if (state.pages.length === 0) return;

  showLoading(true, '正在合成合併的 PDF，請稍候...');

  try {
    const mergedPdf = await PDFLib.PDFDocument.create();
    
    for (const pageItem of state.pages) {
      const srcPdf = await getPdfLibDoc(pageItem.fileId);
      
      // copyPages requires 0-based page index (pageNumber - 1)
      const [copiedPage] = await mergedPdf.copyPages(srcPdf, [pageItem.pageNumber - 1]);
      
      // Apply rotation if any
      if (pageItem.rotation !== 0) {
        const originalAngle = copiedPage.getRotation().angle;
        copiedPage.setRotation(PDFLib.degrees((originalAngle + pageItem.rotation) % 360));
      }
      
      mergedPdf.addPage(copiedPage);
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
      const srcPdf = await getPdfLibDoc(pageItem.fileId);
      
      const singlePageDoc = await PDFLib.PDFDocument.create();
      const [copiedPage] = await singlePageDoc.copyPages(srcPdf, [pageItem.pageNumber - 1]);
      
      // Apply rotation if any
      if (pageItem.rotation !== 0) {
        const originalAngle = copiedPage.getRotation().angle;
        copiedPage.setRotation(PDFLib.degrees((originalAngle + pageItem.rotation) % 360));
      }
      
      singlePageDoc.addPage(copiedPage);
      
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
