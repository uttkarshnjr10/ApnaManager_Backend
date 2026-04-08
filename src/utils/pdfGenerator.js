// src/utils/pdfGenerator.js
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const crypto = require('crypto');

const logger = require('./logger');
const { generateSignedUrl } = require('./cloudinary');

const CONFIG = {
  size: 'A4',
  margin: 42,
  footerReserve: 56,
  fonts: {
    bold: 'Helvetica-Bold',
    normal: 'Helvetica',
    italic: 'Helvetica-Oblique',
  },
  fontSizes: {
    title: 19,
    section: 12,
    body: 10,
    label: 9,
    footer: 8,
    watermark: 74,
  },
  colors: {
    brand: '#0d47a1',
    textPrimary: '#1f2937',
    textMuted: '#667085',
    border: '#d0d5dd',
    divider: '#e4e7ec',
    sectionLine: '#98a2b3',
    cardBg: '#f8f9fc',
    watermark: '#6b7280',
    placeholderBg: '#f2f4f7',
  },
  image: {
    timeoutMs: 4500,
    maxBytes: 5 * 1024 * 1024,
    maxDimension: 1200,
    quality: 82,
  },
};

const LOGO_PATH = path.join(__dirname, '../assets/logo.png');

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
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

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

const maskIdNumber = (idNumber) => {
  const value = safeText(idNumber, 'N/A');
  if (value === 'N/A') return value;
  if (value.length <= 6) return value;
  return `${value.slice(0, 2)}${'*'.repeat(value.length - 4)}${value.slice(-2)}`;
};

const buildAddress = (guest) => {
  const address = guest?.primaryGuest?.address || {};
  const fullAddress = [address.street, address.city, address.state, address.zipCode]
    .filter((part) => part && String(part).trim())
    .join(', ');
  return fullAddress || 'N/A';
};

const buildDocumentRef = (guest) => {
  const source = [
    safeText(guest?.customerId, ''),
    safeText(guest?._id, ''),
    safeText(guest?.idNumber, ''),
    safeText(guest?.stayDetails?.checkIn, ''),
    safeText(guest?.stayDetails?.checkOut, ''),
  ].join('|');

  return crypto.createHash('sha256').update(source).digest('hex').slice(0, 14).toUpperCase();
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
      Subject: 'Guest checkout summary',
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

const drawWatermark = (doc) => {
  const currentX = doc.x;
  const currentY = doc.y;
  const centerX = doc.page.width / 2;
  const centerY = doc.page.height / 2;

  doc.save();
  doc.opacity(0.08);
  doc.fillColor(CONFIG.colors.watermark);
  doc.font(CONFIG.fonts.bold).fontSize(CONFIG.fontSizes.watermark);
  doc.rotate(-33, { origin: [centerX, centerY] });
  doc.text('ApnaManager', centerX - 240, centerY - 32, {
    width: 480,
    align: 'center',
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

const drawHeader = (doc, guest, documentRef) => {
  const area = getPageArea(doc);
  const cardY = area.top;
  const cardHeight = 102;

  doc
    .roundedRect(area.left, cardY, area.contentWidth, cardHeight, 10)
    .fillAndStroke(CONFIG.colors.cardBg, CONFIG.colors.border);

  let titleStartX = area.left + 18;
  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, area.left + 16, cardY + 15, {
        fit: [76, 76],
        align: 'center',
        valign: 'center',
      });
      titleStartX = area.left + 104;
    } catch (error) {
      logger.warn(`Unable to load logo in PDF header: ${error.message}`);
    }
  }

  const metaBoxWidth = 176;
  const headingWidth = area.contentWidth - (metaBoxWidth + 22 + (titleStartX - area.left));
  const hotelName = safeText(guest?.hotel?.hotelName || guest?.hotel?.username, 'Hotel');

  doc
    .font(CONFIG.fonts.bold)
    .fontSize(CONFIG.fontSizes.title)
    .fillColor(CONFIG.colors.brand)
    .text('Guest Checkout Receipt', titleStartX, cardY + 16, { width: headingWidth });

  doc
    .font(CONFIG.fonts.normal)
    .fontSize(9.5)
    .fillColor(CONFIG.colors.textMuted)
    .text('Official checkout summary generated by ApnaManager', titleStartX, cardY + 44, {
      width: headingWidth,
    });

  doc
    .font(CONFIG.fonts.bold)
    .fontSize(12)
    .fillColor(CONFIG.colors.textPrimary)
    .text(hotelName, titleStartX, cardY + 64, { width: headingWidth });

  const metaX = area.right - metaBoxWidth - 12;
  const metaY = cardY + 12;
  const metaHeight = cardHeight - 24;

  doc.roundedRect(metaX, metaY, metaBoxWidth, metaHeight, 7).fillAndStroke('#ffffff', '#dce2f0');

  const metaRows = [
    { label: 'Reference', value: documentRef },
    { label: 'Generated', value: formatDateTime(new Date()) },
    { label: 'Status', value: safeText(guest?.status, 'Checked-Out') },
  ];

  let rowY = metaY + 10;
  metaRows.forEach((row) => {
    doc
      .font(CONFIG.fonts.bold)
      .fontSize(8)
      .fillColor(CONFIG.colors.textMuted)
      .text(`${row.label}:`, metaX + 10, rowY, { width: 64 });

    doc
      .font(CONFIG.fonts.normal)
      .fontSize(8.5)
      .fillColor(CONFIG.colors.textPrimary)
      .text(safeText(row.value), metaX + 74, rowY, {
        width: metaBoxWidth - 84,
        align: 'right',
      });

    rowY += 22;
  });

  doc.y = cardY + cardHeight + 18;
};

const drawSectionTitle = (doc, title) => {
  ensureSpace(doc, 32);
  const area = getPageArea(doc);

  doc
    .font(CONFIG.fonts.bold)
    .fontSize(CONFIG.fontSizes.section)
    .fillColor(CONFIG.colors.brand)
    .text(title, area.left, doc.y, { width: area.contentWidth });

  const lineY = doc.y + 2;
  doc
    .moveTo(area.left, lineY)
    .lineTo(area.right, lineY)
    .strokeColor(CONFIG.colors.sectionLine)
    .lineWidth(0.7)
    .stroke();

  doc.moveDown(0.7);
};

const drawKeyValueGrid = (doc, entries, columns = 2) => {
  const area = getPageArea(doc);
  const safeColumns = Math.max(1, columns);
  const columnGap = 18;
  const columnWidth = (area.contentWidth - columnGap * (safeColumns - 1)) / safeColumns;

  for (let i = 0; i < entries.length; i += safeColumns) {
    const rowEntries = entries.slice(i, i + safeColumns);
    ensureSpace(doc, 30);

    const startY = doc.y;
    let maxRowY = startY;

    rowEntries.forEach((entry, columnIndex) => {
      const x = area.left + columnIndex * (columnWidth + columnGap);
      const labelWidth = Math.min(106, Math.floor(columnWidth * 0.42));
      const valueX = x + labelWidth + 6;
      const valueWidth = columnWidth - labelWidth - 6;

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

    doc.y = maxRowY + 6;
  }

  doc.moveDown(0.15);
};

const drawImagePlaceholder = (doc, x, y, width, height) => {
  doc.rect(x, y, width, height).fillAndStroke(CONFIG.colors.placeholderBg, CONFIG.colors.divider);

  const textY = y + height / 2 - 8;
  doc
    .font(CONFIG.fonts.italic)
    .fontSize(9)
    .fillColor(CONFIG.colors.textMuted)
    .text('Image not available', x + 8, textY, {
      width: width - 16,
      align: 'center',
    });
};

const drawImageCard = (doc, options) => {
  const { x, y, width, height, title, imageBuffer } = options;

  doc.roundedRect(x, y, width, height, 8).lineWidth(1).strokeColor(CONFIG.colors.border).stroke();

  doc
    .rect(x + 1, y + 1, width - 2, 24)
    .fillAndStroke('#f9fafb', CONFIG.colors.divider)
    .fillColor(CONFIG.colors.brand)
    .font(CONFIG.fonts.bold)
    .fontSize(9)
    .text(title, x + 6, y + 8, {
      width: width - 12,
      align: 'center',
    });

  const frameX = x + 8;
  const frameY = y + 32;
  const frameWidth = width - 16;
  const frameHeight = height - 40;

  if (!imageBuffer) {
    drawImagePlaceholder(doc, frameX, frameY, frameWidth, frameHeight);
    return;
  }

  try {
    doc.rect(frameX, frameY, frameWidth, frameHeight).strokeColor(CONFIG.colors.divider).stroke();
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
  ensureSpace(doc, 208);

  const area = getPageArea(doc);
  const gap = 12;
  const cardWidth = (area.contentWidth - gap * 2) / 3;
  const cardHeight = 194;
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
  drawKeyValueGrid(
    doc,
    [
      { label: 'Adults', value: String(adults.length) },
      { label: 'Children', value: String(children.length) },
    ],
    2
  );

  const members = [
    ...adults.map((adult) => {
      return `Adult: ${safeText(adult?.name)} (${safeText(adult?.gender)})`;
    }),
    ...children.map((child) => {
      return `Child: ${safeText(child?.name)} (${safeText(child?.gender)})`;
    }),
  ];

  const preview = members.slice(0, 10);
  const area = getPageArea(doc);

  preview.forEach((line, index) => {
    ensureSpace(doc, 16);
    doc
      .font(CONFIG.fonts.normal)
      .fontSize(9.5)
      .fillColor(CONFIG.colors.textPrimary)
      .text(`${index + 1}. ${line}`, area.left, doc.y, {
        width: area.contentWidth,
      });
  });

  if (members.length > preview.length) {
    ensureSpace(doc, 16);
    doc
      .font(CONFIG.fonts.italic)
      .fontSize(9)
      .fillColor(CONFIG.colors.textMuted)
      .text(`+ ${members.length - preview.length} more accompanying guests`, area.left, doc.y, {
        width: area.contentWidth,
      });
  }

  doc.moveDown(0.3);
};

const drawSecurityNote = (doc, documentRef) => {
  ensureSpace(doc, 58);
  const area = getPageArea(doc);
  const noteY = doc.y;
  const noteHeight = 48;

  doc
    .roundedRect(area.left, noteY, area.contentWidth, noteHeight, 7)
    .fillAndStroke('#f9fafb', CONFIG.colors.border);

  doc
    .font(CONFIG.fonts.bold)
    .fontSize(9)
    .fillColor(CONFIG.colors.brand)
    .text('Security Note', area.left + 10, noteY + 8, { width: area.contentWidth - 20 });

  doc
    .font(CONFIG.fonts.normal)
    .fontSize(8.5)
    .fillColor(CONFIG.colors.textPrimary)
    .text(
      `This document is system-generated by ApnaManager. Verify reference ${documentRef} and guest stay details for authenticity.`,
      area.left + 10,
      noteY + 22,
      {
        width: area.contentWidth - 20,
      }
    );

  doc.y = noteY + noteHeight + 10;
};

const addPageFooters = (doc, guest, documentRef) => {
  const pageRange = doc.bufferedPageRange();
  const hotelName = safeText(guest?.hotel?.hotelName || guest?.hotel?.username, 'Hotel');

  for (let i = 0; i < pageRange.count; i++) {
    doc.switchToPage(i);
    const area = getPageArea(doc);
    const lineY = doc.page.height - CONFIG.margin - 26;

    doc
      .moveTo(area.left, lineY)
      .lineTo(area.right, lineY)
      .strokeColor(CONFIG.colors.divider)
      .lineWidth(0.7)
      .stroke();

    doc
      .font(CONFIG.fonts.normal)
      .fontSize(CONFIG.fontSizes.footer)
      .fillColor(CONFIG.colors.textMuted)
      .text(`Issued by ${hotelName} via ApnaManager`, area.left, lineY + 8, {
        width: 200,
      });

    doc
      .font(CONFIG.fonts.normal)
      .fontSize(CONFIG.fontSizes.footer)
      .fillColor(CONFIG.colors.textMuted)
      .text(`Ref: ${documentRef}`, area.left, lineY + 8, {
        width: area.contentWidth,
        align: 'center',
      });

    doc
      .font(CONFIG.fonts.normal)
      .fontSize(CONFIG.fontSizes.footer)
      .fillColor(CONFIG.colors.textMuted)
      .text(`Page ${i + 1} of ${pageRange.count}`, area.left, lineY + 8, {
        width: area.contentWidth,
        align: 'right',
      });
  }
};

const normalizeImageField = (field) => {
  if (!field) return {};
  if (typeof field === 'string') {
    return { url: field };
  }
  if (typeof field === 'object') {
    return field;
  }
  return {};
};

const isHttpUrl = (value) => {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
};

const getImageCandidates = (field) => {
  const normalized = normalizeImageField(field);
  const urls = [];

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

  return {
    livePhoto,
    idImageFront,
    idImageBack,
  };
};

const renderMainPdf = async (guestData) => {
  const doc = createPdfDoc();
  const outputPromise = collectPdfBuffer(doc);
  const documentRef = buildDocumentRef(guestData);

  registerPageDecorators(doc);

  const images = await loadReceiptImages(guestData);

  drawHeader(doc, guestData, documentRef);

  drawSectionTitle(doc, 'Guest Information');
  drawKeyValueGrid(
    doc,
    [
      { label: 'Guest Name', value: guestData?.primaryGuest?.name },
      { label: 'Customer ID', value: guestData?.customerId },
      { label: 'Phone', value: guestData?.primaryGuest?.phone },
      { label: 'Email', value: guestData?.primaryGuest?.email },
      { label: 'Gender', value: guestData?.primaryGuest?.gender },
      { label: 'Date of Birth', value: formatDate(guestData?.primaryGuest?.dob) },
      { label: 'Address', value: buildAddress(guestData) },
      {
        label: 'Nationality',
        value: guestData?.primaryGuest?.nationality || guestData?.hotel?.nationality,
      },
    ],
    2
  );

  drawSectionTitle(doc, 'Stay Details');
  drawKeyValueGrid(
    doc,
    [
      { label: 'Room Number', value: guestData?.stayDetails?.roomNumber },
      { label: 'Purpose', value: guestData?.stayDetails?.purposeOfVisit },
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

  drawSectionTitle(doc, 'Identity Information');
  drawKeyValueGrid(
    doc,
    [
      { label: 'ID Type', value: guestData?.idType },
      { label: 'ID Number', value: maskIdNumber(guestData?.idNumber) },
    ],
    2
  );

  drawAccompanyingGuestSection(doc, guestData);
  drawImageSection(doc, images);
  drawSecurityNote(doc, documentRef);

  addPageFooters(doc, guestData, documentRef);
  doc.end();

  return outputPromise;
};

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
    .fontSize(10)
    .fillColor(CONFIG.colors.textPrimary)
    .text(
      'Detailed PDF rendering was unavailable at generation time. This fallback receipt is still valid for operational records.',
      area.left,
      doc.y,
      {
        width: area.contentWidth,
      }
    );

  doc.moveDown(0.5);
  doc
    .font(CONFIG.fonts.italic)
    .fontSize(8.5)
    .fillColor(CONFIG.colors.textMuted)
    .text(
      `Reference ${documentRef} | Render note: ${safeText(sourceError?.message, 'Unknown issue')}`,
      {
        width: area.contentWidth,
      }
    );

  addPageFooters(doc, guestData, documentRef);
  doc.end();

  return outputPromise;
};

/**
 * Generates the guest checkout PDF as a Buffer.
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
