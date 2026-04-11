// src/utils/pdfGenerator.js
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const crypto = require('crypto');

const logger = require('./logger');
const { generateSignedUrl } = require('./cloudinary');

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
  size: 'A4',
  margin: 40,
  footerReserve: 50,
  fonts: {
    bold: 'Helvetica-Bold',
    normal: 'Helvetica',
    italic: 'Helvetica-Oblique',
  },
  fontSizes: {
    hotelName: 18,
    title: 13,
    section: 11.5,
    body: 9.5,
    label: 8.5,
    small: 8,
    footer: 7.5,
    watermark: 64,
    tableHeader: 8,
    tableBody: 8.5,
  },
  colors: {
    brand: '#0d47a1',
    brandLight: '#e8eef7',
    brandDark: '#092e6b',
    textPrimary: '#1a1a2e',
    textSecondary: '#4a5568',
    textMuted: '#718096',
    border: '#cbd5e0',
    divider: '#e2e8f0',
    sectionBg: '#f7fafc',
    cardBg: '#ffffff',
    headerBg: '#0d47a1',
    headerText: '#ffffff',
    tableBorder: '#cbd5e0',
    tableHeaderBg: '#edf2f7',
    tableStripeBg: '#f7fafc',
    watermark: '#a0aec0',
    successGreen: '#276749',
    placeholderBg: '#f0f4f8',
  },
  image: {
    timeoutMs: 8000,
    maxBytes: 5 * 1024 * 1024,
    maxDimension: 1200,
    quality: 82,
  },
};

const LOGO_PATH = path.join(__dirname, '../assets/logo.png');

// ============================================================
// UTILITY HELPERS
// ============================================================

const safeText = (value, fallback = 'N/A') => {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
};

const formatDate = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const formatDateTime = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

const calculateAge = (dob) => {
  if (!dob) return null;
  const birthDate = new Date(dob);
  if (Number.isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age >= 0 ? age : null;
};

const formatDobWithAge = (dob) => {
  const dateStr = formatDate(dob);
  if (dateStr === 'N/A') return dateStr;
  const age = calculateAge(dob);
  if (age !== null) {
    return `${dateStr} (${age} yrs)`;
  }
  return dateStr;
};

const maskIdNumber = (idNumber) => {
  const value = safeText(idNumber, 'N/A');
  if (value === 'N/A') return value;
  if (value.length <= 6) return value;
  return `${value.slice(0, 2)}${'*'.repeat(value.length - 4)}${value.slice(-2)}`;
};

const buildAddress = (guest) => {
  const address = guest?.primaryGuest?.address || {};
  const parts = [address.street, address.city, address.state, address.zipCode].filter(
    (part) => part && String(part).trim()
  );
  return parts.join(', ') || 'N/A';
};

const buildHotelAddress = (hotel) => {
  const parts = [hotel?.address, hotel?.city, hotel?.state, hotel?.pinCode].filter(
    (part) => part && String(part).trim()
  );
  return parts.join(', ') || '';
};

const buildDocumentRef = (guest) => {
  const source = [
    safeText(guest?.customerId, ''),
    safeText(guest?._id, ''),
    safeText(guest?.idNumber, ''),
    safeText(guest?.stayDetails?.checkIn, ''),
    safeText(guest?.stayDetails?.checkOut, ''),
  ].join('|');

  return crypto.createHash('sha256').update(source).digest('hex').slice(0, 12).toUpperCase();
};

// ============================================================
// PDF DOCUMENT SETUP
// ============================================================

const getPageArea = (doc) => {
  return {
    left: CONFIG.margin,
    right: doc.page.width - CONFIG.margin,
    top: CONFIG.margin,
    bottom: doc.page.height - CONFIG.margin,
    contentWidth: doc.page.width - CONFIG.margin * 2,
  };
};

const ensureSpace = (doc, requiredHeight = 40) => {
  const maxY = doc.page.height - CONFIG.margin - CONFIG.footerReserve;
  if (doc.y + requiredHeight > maxY) {
    doc.addPage();
  }
};

const createPdfDoc = () => {
  return new PDFDocument({
    size: CONFIG.size,
    margin: CONFIG.margin,
    layout: 'portrait',
    bufferPages: true,
    info: {
      Title: 'Guest Checkout Receipt',
      Author: 'ApnaManager',
      Subject: 'Official guest checkout summary',
      Producer: 'ApnaManager PDF Service',
    },
  });
};

const collectPdfBuffer = (doc) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
};

// ============================================================
// WATERMARK — Fixed: single-line rendering
// ============================================================

const drawWatermark = (doc) => {
  const currentX = doc.x;
  const currentY = doc.y;
  const centerX = doc.page.width / 2;
  const centerY = doc.page.height / 2;

  doc.save();
  doc.opacity(0.04);
  doc.fillColor(CONFIG.colors.watermark);
  doc.font(CONFIG.fonts.bold).fontSize(CONFIG.fontSizes.watermark);

  // Measure actual text width to ensure it never wraps
  const textWidth = doc.widthOfString('ApnaManager');
  const textX = centerX - textWidth / 2;

  doc.rotate(-35, { origin: [centerX, centerY] });
  doc.text('ApnaManager', textX, centerY - 20, {
    lineBreak: false,
  });
  doc.restore();

  doc.opacity(1);
  doc.fillColor(CONFIG.colors.textPrimary);
  doc.x = currentX;
  doc.y = currentY;
};

const registerPageDecorators = (doc) => {
  drawWatermark(doc);
  doc.on('pageAdded', () => {
    drawWatermark(doc);
  });
};

// ============================================================
// HEADER — Hotel-branded professional layout
// ============================================================

const drawHeader = (doc, guest, documentRef) => {
  const area = getPageArea(doc);
  const hotelName = safeText(guest?.hotel?.hotelName || guest?.hotel?.username, 'Hotel');
  const hotelAddress = buildHotelAddress(guest?.hotel);
  const hotelPhone = safeText(guest?.hotel?.phone, '');

  // ── Top brand bar ──
  const barHeight = 6;
  doc.rect(area.left, area.top, area.contentWidth, barHeight).fill(CONFIG.colors.brand);

  const headerY = area.top + barHeight + 14;

  // ── Left side: Logo + Hotel info ──
  let infoX = area.left;
  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, area.left, headerY, {
        fit: [48, 48],
        align: 'center',
        valign: 'center',
      });
      infoX = area.left + 56;
    } catch (error) {
      logger.warn(`Unable to load logo in PDF header: ${error.message}`);
    }
  }

  const metaBoxWidth = 170;
  const leftWidth = area.contentWidth - metaBoxWidth - 20;

  // Hotel name
  doc
    .font(CONFIG.fonts.bold)
    .fontSize(CONFIG.fontSizes.hotelName)
    .fillColor(CONFIG.colors.brand)
    .text(hotelName, infoX, headerY, { width: leftWidth, lineBreak: false });

  // "Checkout Receipt" subtitle
  doc
    .font(CONFIG.fonts.normal)
    .fontSize(CONFIG.fontSizes.title)
    .fillColor(CONFIG.colors.textSecondary)
    .text('Guest Checkout Receipt', infoX, headerY + 22, { width: leftWidth });

  // Hotel contact line
  const contactParts = [hotelAddress, hotelPhone].filter(Boolean);
  if (contactParts.length > 0) {
    doc
      .font(CONFIG.fonts.normal)
      .fontSize(CONFIG.fontSizes.small)
      .fillColor(CONFIG.colors.textMuted)
      .text(contactParts.join('  |  '), infoX, headerY + 38, { width: leftWidth });
  }

  // ── Right side: Meta info box ──
  const metaX = area.right - metaBoxWidth;
  const metaY = headerY;
  const metaHeight = 68;

  doc
    .roundedRect(metaX, metaY, metaBoxWidth, metaHeight, 6)
    .lineWidth(0.8)
    .strokeColor(CONFIG.colors.border)
    .stroke();

  const metaRows = [
    { label: 'Reference', value: documentRef },
    { label: 'Customer ID', value: safeText(guest?.customerId) },
    { label: 'Generated', value: formatDateTime(new Date()) },
    { label: 'Status', value: safeText(guest?.status, 'Checked-Out') },
  ];

  let rowY = metaY + 6;
  metaRows.forEach((row) => {
    doc
      .font(CONFIG.fonts.bold)
      .fontSize(7)
      .fillColor(CONFIG.colors.textMuted)
      .text(`${row.label}:`, metaX + 8, rowY, { width: 56, lineBreak: false });

    doc
      .font(CONFIG.fonts.normal)
      .fontSize(7.5)
      .fillColor(CONFIG.colors.textPrimary)
      .text(safeText(row.value), metaX + 64, rowY, {
        width: metaBoxWidth - 72,
        align: 'right',
        lineBreak: false,
      });

    rowY += 15;
  });

  // ── Separator line ──
  const sepY = headerY + 58;
  doc
    .moveTo(area.left, sepY)
    .lineTo(area.right, sepY)
    .strokeColor(CONFIG.colors.divider)
    .lineWidth(0.5)
    .stroke();

  doc.y = sepY + 14;
};

// ============================================================
// SECTION TITLE — Clean underlined section headers
// ============================================================

const drawSectionTitle = (doc, title) => {
  ensureSpace(doc, 30);
  const area = getPageArea(doc);

  doc
    .font(CONFIG.fonts.bold)
    .fontSize(CONFIG.fontSizes.section)
    .fillColor(CONFIG.colors.brand)
    .text(title.toUpperCase(), area.left, doc.y, {
      width: area.contentWidth,
      characterSpacing: 0.5,
    });

  const lineY = doc.y + 3;
  doc
    .moveTo(area.left, lineY)
    .lineTo(area.left + 60, lineY)
    .strokeColor(CONFIG.colors.brand)
    .lineWidth(1.5)
    .stroke();

  // Light full-width divider
  doc
    .moveTo(area.left + 60, lineY)
    .lineTo(area.right, lineY)
    .strokeColor(CONFIG.colors.divider)
    .lineWidth(0.5)
    .stroke();

  doc.y = lineY + 10;
};

// ============================================================
// KEY-VALUE GRID — Clean 2-column data display
// ============================================================

const drawKeyValueGrid = (doc, entries, columns = 2) => {
  const area = getPageArea(doc);
  const safeColumns = Math.max(1, columns);
  const columnGap = 16;
  const columnWidth = (area.contentWidth - columnGap * (safeColumns - 1)) / safeColumns;

  for (let i = 0; i < entries.length; i += safeColumns) {
    const rowEntries = entries.slice(i, i + safeColumns);
    ensureSpace(doc, 28);

    const startY = doc.y;
    let maxRowY = startY;

    rowEntries.forEach((entry, columnIndex) => {
      const x = area.left + columnIndex * (columnWidth + columnGap);
      const labelWidth = Math.min(100, Math.floor(columnWidth * 0.4));
      const valueX = x + labelWidth + 4;
      const valueWidth = columnWidth - labelWidth - 4;

      doc
        .font(CONFIG.fonts.bold)
        .fontSize(CONFIG.fontSizes.label)
        .fillColor(CONFIG.colors.textMuted)
        .text(`${safeText(entry.label, '-')}:`, x, startY, {
          width: labelWidth,
        });

      doc
        .font(CONFIG.fonts.normal)
        .fontSize(CONFIG.fontSizes.body)
        .fillColor(CONFIG.colors.textPrimary)
        .text(safeText(entry.value), valueX, startY, {
          width: valueWidth,
        });

      maxRowY = Math.max(maxRowY, doc.y);
    });

    doc.y = maxRowY + 5;
  }

  doc.moveDown(0.2);
};

// ============================================================
// ACCOMPANYING GUESTS — Professional table layout
// ============================================================

const drawAccompanyingGuestSection = (doc, guest) => {
  const adults = Array.isArray(guest?.accompanyingGuests?.adults)
    ? guest.accompanyingGuests.adults
    : [];
  const children = Array.isArray(guest?.accompanyingGuests?.children)
    ? guest.accompanyingGuests.children
    : [];

  if (adults.length === 0 && children.length === 0) {
    return;
  }

  drawSectionTitle(doc, 'Accompanying Guests');

  // Summary row
  drawKeyValueGrid(
    doc,
    [
      { label: 'Total Adults', value: String(adults.length) },
      { label: 'Total Children', value: String(children.length) },
    ],
    2
  );

  // Build table rows
  const allGuests = [
    ...adults.map((g) => ({ ...g, type: 'Adult' })),
    ...children.map((g) => ({ ...g, type: 'Child' })),
  ];

  if (allGuests.length === 0) return;

  const area = getPageArea(doc);

  // Table column definitions
  const cols = [
    { header: '#', width: 22, align: 'center' },
    { header: 'Name', width: 120, align: 'left' },
    { header: 'Type', width: 45, align: 'center' },
    { header: 'Gender', width: 50, align: 'center' },
    { header: 'DOB / Age', width: 90, align: 'center' },
    { header: 'ID Type', width: 65, align: 'center' },
    { header: 'ID Number', width: 0, align: 'center' }, // flex fill remaining
  ];

  // Calculate flex column width
  const fixedWidth = cols.reduce((sum, c) => sum + c.width, 0);
  cols[cols.length - 1].width = area.contentWidth - fixedWidth;

  const rowHeight = 18;
  const headerHeight = 20;

  // ── Draw table header ──
  ensureSpace(doc, headerHeight + rowHeight * 2);
  const tableX = area.left;
  let tableY = doc.y;

  // Header background
  doc.rect(tableX, tableY, area.contentWidth, headerHeight).fill(CONFIG.colors.tableHeaderBg);

  // Header border
  doc
    .rect(tableX, tableY, area.contentWidth, headerHeight)
    .strokeColor(CONFIG.colors.tableBorder)
    .lineWidth(0.5)
    .stroke();

  // Header text
  let colX = tableX;
  cols.forEach((col) => {
    doc
      .font(CONFIG.fonts.bold)
      .fontSize(CONFIG.fontSizes.tableHeader)
      .fillColor(CONFIG.colors.textSecondary)
      .text(col.header, colX + 4, tableY + 5, {
        width: col.width - 8,
        align: col.align,
        lineBreak: false,
      });
    colX += col.width;
  });

  tableY += headerHeight;

  // ── Draw table rows ──
  allGuests.forEach((g, index) => {
    ensureSpace(doc, rowHeight + 4);

    // Stripe alternating rows
    if (index % 2 === 0) {
      doc.rect(tableX, tableY, area.contentWidth, rowHeight).fill(CONFIG.colors.tableStripeBg);
    }

    // Row border
    doc
      .rect(tableX, tableY, area.contentWidth, rowHeight)
      .strokeColor(CONFIG.colors.tableBorder)
      .lineWidth(0.3)
      .stroke();

    const age = calculateAge(g.dob);
    const dobAge = g.dob ? `${formatDate(g.dob)}${age !== null ? ` (${age})` : ''}` : 'N/A';

    const rowData = [
      String(index + 1),
      safeText(g.name),
      safeText(g.type),
      safeText(g.gender),
      dobAge,
      safeText(g.idType, '-'),
      g.idNumber ? maskIdNumber(g.idNumber) : '-',
    ];

    colX = tableX;
    rowData.forEach((cellValue, ci) => {
      doc
        .font(CONFIG.fonts.normal)
        .fontSize(CONFIG.fontSizes.tableBody)
        .fillColor(CONFIG.colors.textPrimary)
        .text(cellValue, colX + 4, tableY + 5, {
          width: cols[ci].width - 8,
          align: cols[ci].align,
          lineBreak: false,
        });
      colX += cols[ci].width;
    });

    tableY += rowHeight;
  });

  doc.y = tableY + 10;
};

// ============================================================
// IMAGE HANDLING — Secure signed URL flow
// ============================================================

const normalizeImageField = (field) => {
  if (!field) return {};
  if (typeof field === 'string') return { url: field };
  if (typeof field === 'object') return field;
  return {};
};

const isHttpUrl = (value) => {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
};

const getImageCandidates = (field) => {
  const normalized = normalizeImageField(field);
  const urls = [];

  // Priority 1: Generate a fresh signed URL from public_id (most secure)
  if (normalized.public_id) {
    try {
      const signedUrl = generateSignedUrl(normalized.public_id);
      if (isHttpUrl(signedUrl)) {
        urls.push(signedUrl);
      }
    } catch (error) {
      logger.warn(`Failed to generate signed URL for image: ${error.message}`);
    }
  }

  // Priority 2: Fall back to stored URL
  if (isHttpUrl(normalized.url)) {
    urls.push(normalized.url);
  }

  return [...new Set(urls)];
};

const fetchAndOptimizeImage = async (url) => {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: CONFIG.image.timeoutMs,
    maxContentLength: CONFIG.image.maxBytes,
    maxBodyLength: CONFIG.image.maxBytes,
    validateStatus: (status) => status >= 200 && status < 300,
  });

  const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
  if (contentType && !contentType.startsWith('image/')) {
    throw new Error(`Unexpected content type: ${contentType}`);
  }

  const inputBuffer = Buffer.from(response.data);
  if (!inputBuffer.length) {
    throw new Error('Empty image data');
  }

  return sharp(inputBuffer)
    .rotate()
    .resize(CONFIG.image.maxDimension, CONFIG.image.maxDimension, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: CONFIG.image.quality })
    .toBuffer();
};

const loadImageBuffer = async (field, label) => {
  const candidates = getImageCandidates(field);
  if (!candidates.length) {
    return null;
  }

  for (const candidate of candidates) {
    try {
      return await fetchAndOptimizeImage(candidate);
    } catch (error) {
      logger.warn(`Unable to load ${label} image for PDF: ${error.message}`);
    }
  }

  return null;
};

const loadReceiptImages = async (guest) => {
  const [livePhoto, idImageFront, idImageBack] = await Promise.all([
    loadImageBuffer(guest?.livePhoto, 'live photo'),
    loadImageBuffer(guest?.idImageFront, 'ID front'),
    loadImageBuffer(guest?.idImageBack, 'ID back'),
  ]);

  return { livePhoto, idImageFront, idImageBack };
};

// ============================================================
// IMAGE SECTION — Clean 3-column card layout
// ============================================================

const drawImagePlaceholder = (doc, x, y, width, height) => {
  doc.rect(x, y, width, height).fillAndStroke(CONFIG.colors.placeholderBg, CONFIG.colors.divider);

  const textY = y + height / 2 - 6;
  doc
    .font(CONFIG.fonts.italic)
    .fontSize(8)
    .fillColor(CONFIG.colors.textMuted)
    .text('Image not available', x + 4, textY, {
      width: width - 8,
      align: 'center',
    });
};

const drawImageCard = (doc, options) => {
  const { x, y, width, height, title, imageBuffer } = options;

  // Card border
  doc.roundedRect(x, y, width, height, 6).lineWidth(0.8).strokeColor(CONFIG.colors.border).stroke();

  // Title bar
  const titleBarHeight = 22;
  doc.rect(x + 0.5, y + 0.5, width - 1, titleBarHeight).fill(CONFIG.colors.tableHeaderBg);

  doc
    .font(CONFIG.fonts.bold)
    .fontSize(8)
    .fillColor(CONFIG.colors.brand)
    .text(title, x + 4, y + 7, {
      width: width - 8,
      align: 'center',
      lineBreak: false,
    });

  const frameX = x + 6;
  const frameY = y + titleBarHeight + 6;
  const frameWidth = width - 12;
  const frameHeight = height - titleBarHeight - 12;

  if (!imageBuffer) {
    drawImagePlaceholder(doc, frameX, frameY, frameWidth, frameHeight);
    return;
  }

  try {
    doc
      .rect(frameX, frameY, frameWidth, frameHeight)
      .strokeColor(CONFIG.colors.divider)
      .lineWidth(0.3)
      .stroke();

    doc.image(imageBuffer, frameX, frameY, {
      fit: [frameWidth, frameHeight],
      align: 'center',
      valign: 'center',
    });
  } catch (error) {
    logger.warn(`Failed to embed ${title} image in PDF: ${error.message}`);
    drawImagePlaceholder(doc, frameX, frameY, frameWidth, frameHeight);
  }
};

const drawImageSection = (doc, images) => {
  drawSectionTitle(doc, 'Verification Images');
  ensureSpace(doc, 200);

  const area = getPageArea(doc);
  const gap = 10;
  const cardWidth = (area.contentWidth - gap * 2) / 3;
  const cardHeight = 180;
  const startY = doc.y;

  drawImageCard(doc, {
    x: area.left,
    y: startY,
    width: cardWidth,
    height: cardHeight,
    title: 'Live Photo',
    imageBuffer: images.livePhoto,
  });

  drawImageCard(doc, {
    x: area.left + cardWidth + gap,
    y: startY,
    width: cardWidth,
    height: cardHeight,
    title: 'ID Front',
    imageBuffer: images.idImageFront,
  });

  drawImageCard(doc, {
    x: area.left + (cardWidth + gap) * 2,
    y: startY,
    width: cardWidth,
    height: cardHeight,
    title: 'ID Back',
    imageBuffer: images.idImageBack,
  });

  doc.y = startY + cardHeight + 12;
};

// ============================================================
// SECURITY NOTE
// ============================================================

const drawSecurityNote = (doc, documentRef) => {
  ensureSpace(doc, 50);
  const area = getPageArea(doc);
  const noteY = doc.y;
  const noteHeight = 40;

  doc
    .roundedRect(area.left, noteY, area.contentWidth, noteHeight, 5)
    .lineWidth(0.5)
    .fillAndStroke(CONFIG.colors.sectionBg, CONFIG.colors.border);

  doc
    .font(CONFIG.fonts.bold)
    .fontSize(7.5)
    .fillColor(CONFIG.colors.textSecondary)
    .text('SECURITY NOTE', area.left + 10, noteY + 8, { width: area.contentWidth - 20 });

  doc
    .font(CONFIG.fonts.normal)
    .fontSize(7)
    .fillColor(CONFIG.colors.textMuted)
    .text(
      `This is a system-generated document. Verify reference ${documentRef} for authenticity. Do not share personal information from this receipt.`,
      area.left + 10,
      noteY + 20,
      { width: area.contentWidth - 20 }
    );

  doc.y = noteY + noteHeight + 8;
};

// ============================================================
// FOOTER — Hotel-branded with subtle ApnaManager credit
// ============================================================

const addPageFooters = (doc, guest, documentRef) => {
  const pageRange = doc.bufferedPageRange();
  const hotelName = safeText(guest?.hotel?.hotelName || guest?.hotel?.username, 'Hotel');

  for (let i = 0; i < pageRange.count; i++) {
    doc.switchToPage(i);
    const area = getPageArea(doc);
    const lineY = doc.page.height - CONFIG.margin - 22;

    // Divider line
    doc
      .moveTo(area.left, lineY)
      .lineTo(area.right, lineY)
      .strokeColor(CONFIG.colors.divider)
      .lineWidth(0.5)
      .stroke();

    // Left: Hotel name
    doc
      .font(CONFIG.fonts.bold)
      .fontSize(CONFIG.fontSizes.footer)
      .fillColor(CONFIG.colors.textMuted)
      .text(`${hotelName}`, area.left, lineY + 6, {
        width: 180,
        lineBreak: false,
      });

    // Center: Reference + powered by
    doc
      .font(CONFIG.fonts.normal)
      .fontSize(CONFIG.fontSizes.footer)
      .fillColor(CONFIG.colors.textMuted)
      .text(`Ref: ${documentRef}  •  Powered by ApnaManager`, area.left, lineY + 6, {
        width: area.contentWidth,
        align: 'center',
        lineBreak: false,
      });

    // Right: Page number
    doc
      .font(CONFIG.fonts.normal)
      .fontSize(CONFIG.fontSizes.footer)
      .fillColor(CONFIG.colors.textMuted)
      .text(`Page ${i + 1} of ${pageRange.count}`, area.left, lineY + 6, {
        width: area.contentWidth,
        align: 'right',
        lineBreak: false,
      });
  }
};

// ============================================================
// MAIN PDF RENDERER
// ============================================================

const renderMainPdf = async (guestData) => {
  const doc = createPdfDoc();
  const outputPromise = collectPdfBuffer(doc);
  const documentRef = buildDocumentRef(guestData);

  registerPageDecorators(doc);

  // Load images from Cloudinary via signed URLs (server-side only)
  const images = await loadReceiptImages(guestData);

  // ── Header ──
  drawHeader(doc, guestData, documentRef);

  // ── Guest Information ──
  drawSectionTitle(doc, 'Guest Information');
  drawKeyValueGrid(
    doc,
    [
      { label: 'Guest Name', value: guestData?.primaryGuest?.name },
      { label: 'Customer ID', value: guestData?.customerId },
      { label: 'Phone', value: guestData?.primaryGuest?.phone },
      { label: 'Email', value: guestData?.primaryGuest?.email },
      { label: 'Gender', value: guestData?.primaryGuest?.gender },
      { label: 'Date of Birth', value: formatDobWithAge(guestData?.primaryGuest?.dob) },
      { label: 'Address', value: buildAddress(guestData) },
      {
        label: 'Nationality',
        value: guestData?.primaryGuest?.nationality || guestData?.hotel?.nationality || 'N/A',
      },
    ],
    2
  );

  // ── Stay Details ──
  drawSectionTitle(doc, 'Stay Details');
  drawKeyValueGrid(
    doc,
    [
      { label: 'Room Number', value: guestData?.stayDetails?.roomNumber },
      { label: 'Purpose of Visit', value: guestData?.stayDetails?.purposeOfVisit },
      { label: 'Check-In', value: formatDateTime(guestData?.stayDetails?.checkIn) },
      {
        label: 'Expected Checkout',
        value: formatDateTime(guestData?.stayDetails?.expectedCheckout),
      },
      {
        label: 'Actual Checkout',
        value: formatDateTime(guestData?.stayDetails?.checkOut || new Date()),
      },
      { label: 'Registered On', value: formatDateTime(guestData?.registrationTimestamp) },
    ],
    2
  );

  // ── Identity Information ──
  drawSectionTitle(doc, 'Identity Information');
  drawKeyValueGrid(
    doc,
    [
      { label: 'ID Type', value: guestData?.idType },
      { label: 'ID Number', value: maskIdNumber(guestData?.idNumber) },
    ],
    2
  );

  // ── Accompanying Guests (table) ──
  drawAccompanyingGuestSection(doc, guestData);

  // ── Verification Images ──
  drawImageSection(doc, images);

  // ── Security Note ──
  drawSecurityNote(doc, documentRef);

  // ── Footers (applied to all pages) ──
  addPageFooters(doc, guestData, documentRef);
  doc.end();

  return outputPromise;
};

// ============================================================
// FALLBACK PDF (when main render fails)
// ============================================================

const renderFallbackPdf = async (guestData, sourceError) => {
  const doc = createPdfDoc();
  const outputPromise = collectPdfBuffer(doc);
  const documentRef = buildDocumentRef(guestData);

  registerPageDecorators(doc);

  drawHeader(doc, guestData, documentRef);

  drawSectionTitle(doc, 'Guest Information');
  drawKeyValueGrid(
    doc,
    [
      { label: 'Guest Name', value: guestData?.primaryGuest?.name },
      { label: 'Customer ID', value: guestData?.customerId },
      { label: 'Hotel', value: guestData?.hotel?.hotelName || guestData?.hotel?.username },
      {
        label: 'Checkout Time',
        value: formatDateTime(guestData?.stayDetails?.checkOut || new Date()),
      },
    ],
    2
  );

  drawSectionTitle(doc, 'Notice');
  const area = getPageArea(doc);
  doc
    .font(CONFIG.fonts.normal)
    .fontSize(CONFIG.fontSizes.body)
    .fillColor(CONFIG.colors.textPrimary)
    .text(
      'Detailed PDF rendering was unavailable at generation time. This fallback receipt is still valid for operational records.',
      area.left,
      doc.y,
      { width: area.contentWidth }
    );

  doc.moveDown(0.5);
  doc
    .font(CONFIG.fonts.italic)
    .fontSize(CONFIG.fontSizes.small)
    .fillColor(CONFIG.colors.textMuted)
    .text(
      `Reference ${documentRef} | Render note: ${safeText(sourceError?.message, 'Unknown issue')}`,
      { width: area.contentWidth }
    );

  addPageFooters(doc, guestData, documentRef);
  doc.end();

  return outputPromise;
};

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Generates the guest checkout PDF as a Buffer.
 * Images are fetched server-side via time-limited signed Cloudinary URLs,
 * optimized with Sharp, and embedded as raw buffers — no public URLs in PDF.
 *
 * @param {object} guestData - Guest document populated with hotel details.
 * @returns {Promise<Buffer>} PDF Buffer
 */
const generateGuestPDF = async (guestData) => {
  try {
    return await renderMainPdf(guestData || {});
  } catch (error) {
    logger.error(`Primary PDF generation failed: ${error.message}`);

    try {
      return await renderFallbackPdf(guestData || {}, error);
    } catch (fallbackError) {
      logger.error(`Fallback PDF generation failed: ${fallbackError.message}`);
      throw fallbackError;
    }
  }
};

module.exports = generateGuestPDF;
