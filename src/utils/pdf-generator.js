// src/utils/pdf-generator.js
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const crypto = require('crypto');

const logger = require('./logger');
const { generateSignedUrl } = require('./cloudinary');

// ============================================================
// CONFIGURATION — Premium Compact Single-Page-First Design
// ============================================================

const CONFIG = {
  size: 'A4', // 595.28 x 841.89 pt
  margin: 28,
  footerReserve: 34,
  fonts: {
    bold: 'Helvetica-Bold',
    normal: 'Helvetica',
    italic: 'Helvetica-Oblique',
  },
  fontSizes: {
    hotelName: 15,
    subtitle: 7.5,
    sectionTitle: 8.5,
    body: 8,
    label: 7,
    small: 6.8,
    footer: 6.5,
    watermark: 60,
    badge: 6.8,
    statusBar: 7.2,
  },
  colors: {
    brand: '#0f2942',
    brandLight: '#f0f5ff',
    brandAccent: '#1d4ed8',
    sectionBg: '#16324f',
    sectionText: '#ffffff',
    textPrimary: '#0f172a',
    textSecondary: '#334155',
    textMuted: '#64748b',
    border: '#cbd5e1',
    borderLight: '#e2e8f0',
    divider: '#cbd5e1',
    cardBg: '#ffffff',
    cardHeaderBg: '#f8fafc',
    cellBg: '#f8fafc',
    successGreen: '#16a34a',
    successBg: '#dcfce7',
    verifiedBadge: '#15803d',
    placeholderBg: '#f8fafc',
    watermark: '#94a3b8',
    declarationBg: '#f8fafc',
  },
  image: {
    timeoutMs: 8000,
    maxBytes: 5 * 1024 * 1024,
    maxDimension: 1000,
    quality: 84,
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

const formatTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-IN', {
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

const formatDobWithAgeAndGender = (dob, gender) => {
  const dateStr = formatDate(dob);
  if (dateStr === 'N/A') return safeText(gender, 'N/A');
  const age = calculateAge(dob);
  const parts = [dateStr];
  if (age !== null) parts.push(`(${age} Yrs)`);
  if (gender) parts.push(`• ${gender}`);
  return parts.join(' ');
};

const maskIdNumber = (idNumber) => {
  const value = safeText(idNumber, 'N/A');
  if (value === 'N/A') return value;
  const clean = value.replace(/\s+/g, '');
  if (clean.length <= 6) return clean;
  const prefix = clean.slice(0, 4);
  const suffix = clean.slice(-4);
  return `${prefix}-XXXX-${suffix}`;
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
  // Deduplicate adjacent identical city/address parts (e.g. "Patna, Patna")
  const uniqueParts = parts.filter((item, pos, arr) => pos === 0 || item.toLowerCase() !== arr[pos - 1].toLowerCase());
  return uniqueParts.join(', ') || '';
};

const buildBookingRef = (guest) => {
  const source = [
    safeText(guest?.customerId, ''),
    safeText(guest?._id, ''),
    safeText(guest?.stayDetails?.checkIn, ''),
  ].join('|');
  return `GP-${crypto.createHash('sha256').update(source).digest('hex').slice(0, 12).toUpperCase()}`;
};

const getAllAccompanyingGuests = (guest) => {
  const adults = Array.isArray(guest?.accompanyingGuests?.adults)
    ? guest.accompanyingGuests.adults.map((g) => ({ ...g, category: 'Adult' }))
    : [];
  const children = Array.isArray(guest?.accompanyingGuests?.children)
    ? guest.accompanyingGuests.children.map((g) => ({ ...g, category: 'Child' }))
    : [];
  return [...adults, ...children];
};

const getOccupancyText = (guest) => {
  const adults = Array.isArray(guest?.accompanyingGuests?.adults) ? guest.accompanyingGuests.adults.length : 0;
  const children = Array.isArray(guest?.accompanyingGuests?.children) ? guest.accompanyingGuests.children.length : 0;
  const totalPeople = 1 + adults + children;
  if (adults === 0 && children === 0) return '1 Person (Single Occupant)';
  const detail = [`${1 + adults} Adult${1 + adults > 1 ? 's' : ''}`];
  if (children > 0) detail.push(`${children} Child${children > 1 ? 'ren' : ''}`);
  return `${totalPeople} People (${detail.join(', ')})`;
};

// ============================================================
// PDF DOCUMENT SETUP & PAGE MANAGEMENT
// ============================================================

const getPageArea = (doc) => ({
  left: CONFIG.margin,
  right: doc.page.width - CONFIG.margin,
  top: CONFIG.margin,
  bottom: doc.page.height - CONFIG.margin,
  contentWidth: doc.page.width - CONFIG.margin * 2,
});

const ensureSpace = (doc, requiredHeight = 40) => {
  const maxY = doc.page.height - CONFIG.margin - CONFIG.footerReserve;
  if (doc.y + requiredHeight > maxY) {
    doc.addPage();
    return true;
  }
  return false;
};

const createPdfDoc = () => {
  return new PDFDocument({
    size: CONFIG.size,
    margin: CONFIG.margin,
    layout: 'portrait',
    bufferPages: true,
    info: {
      Title: 'Guest Checkout Receipt',
      Author: 'Apna Register',
      Subject: 'Official Guest Checkout & Digital KYC Summary',
      Producer: 'Apna Register PDF Service',
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
// WATERMARK
// ============================================================

const drawWatermark = (doc) => {
  const currentX = doc.x;
  const currentY = doc.y;
  const centerX = doc.page.width / 2;
  const centerY = doc.page.height / 2;

  doc.save();
  doc.opacity(0.03);
  doc.fillColor(CONFIG.colors.watermark);
  doc.font(CONFIG.fonts.bold).fontSize(CONFIG.fontSizes.watermark);

  const textWidth = doc.widthOfString('APNA REGISTER');
  const textX = centerX - textWidth / 2;

  doc.rotate(-35, { origin: [centerX, centerY] });
  doc.text('APNA REGISTER', textX, centerY - 20, { lineBreak: false });
  doc.restore();

  doc.opacity(1);
  doc.fillColor(CONFIG.colors.textPrimary);
  doc.x = currentX;
  doc.y = currentY;
};

const registerPageDecorators = (doc) => {
  drawWatermark(doc);
  doc.on('pageAdded', () => drawWatermark(doc));
};

// ============================================================
// IMAGE HANDLING — Supports Signed URLs, Direct URLs & Base64
// ============================================================

const normalizeImageField = (field) => {
  if (!field) return {};
  if (typeof field === 'string') return { url: field };
  if (typeof field === 'object') return field;
  return {};
};

const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value);
const isDataUri = (value) => typeof value === 'string' && /^data:image\/[a-zA-Z+]+;base64,/i.test(value);

const getImageCandidates = (field) => {
  const normalized = normalizeImageField(field);
  const urls = [];

  if (normalized.public_id) {
    try {
      const signedUrl = generateSignedUrl(normalized.public_id);
      if (isHttpUrl(signedUrl)) urls.push(signedUrl);
    } catch (error) {
      logger.warn(`Failed to generate signed URL for ${normalized.public_id}: ${error.message}`);
    }
  }

  // Also include direct URL as fallback (critical if hotelStamp/ownerSignature are uploaded as 'upload' instead of 'authenticated')
  if (isHttpUrl(normalized.url) || isDataUri(normalized.url)) {
    urls.push(normalized.url);
  }

  return [...new Set(urls)];
};

const optimizeImageBuffer = async (inputBuffer, preserveTransparency = false) => {
  if (!inputBuffer || !inputBuffer.length) throw new Error('Empty image buffer');

  let pipeline = sharp(inputBuffer)
    .rotate()
    .resize(CONFIG.image.maxDimension, CONFIG.image.maxDimension, {
      fit: 'inside',
      withoutEnlargement: true,
    });

  if (preserveTransparency) {
    // Flatten transparent PNGs (like signatures & stamps) onto white so they never render as black boxes
    pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } }).png({ compressionLevel: 8 });
  } else {
    pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } }).jpeg({ quality: CONFIG.image.quality });
  }

  return pipeline.toBuffer();
};

const fetchAndOptimizeImage = async (candidate, preserveTransparency = false) => {
  if (isDataUri(candidate)) {
    const base64Data = candidate.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');
    return optimizeImageBuffer(buffer, preserveTransparency);
  }

  const response = await axios.get(candidate, {
    responseType: 'arraybuffer',
    timeout: CONFIG.image.timeoutMs,
    maxContentLength: CONFIG.image.maxBytes,
    maxBodyLength: CONFIG.image.maxBytes,
    validateStatus: (status) => status >= 200 && status < 300,
  });

  const inputBuffer = Buffer.from(response.data);
  return optimizeImageBuffer(inputBuffer, preserveTransparency);
};

const loadImageBuffer = async (field, label, preserveTransparency = false) => {
  const candidates = getImageCandidates(field);
  if (!candidates.length) return null;

  for (const candidate of candidates) {
    try {
      return await fetchAndOptimizeImage(candidate, preserveTransparency);
    } catch (error) {
      logger.warn(`Unable to load ${label} image from candidate: ${error.message}`);
    }
  }
  return null;
};

const loadReceiptImages = async (guest) => {
  const allAccompanying = getAllAccompanyingGuests(guest);

  const [livePhoto, idImageFront, idImageBack, ownerSignature, hotelStamp, guestSignature, accompanyingImages] =
    await Promise.all([
      loadImageBuffer(guest?.livePhoto, 'primary live photo', false),
      loadImageBuffer(guest?.idImageFront, 'primary ID front', false),
      loadImageBuffer(guest?.idImageBack, 'primary ID back', false),
      loadImageBuffer(guest?.hotel?.ownerSignature, 'owner signature', true),
      loadImageBuffer(guest?.hotel?.hotelStamp, 'hotel stamp', true),
      loadImageBuffer(guest?.consentRecord?.signatureImage, 'guest consent signature', true),
      Promise.all(
        allAccompanying.map(async (accGuest, idx) => {
          const [accLive, accFront, accBack] = await Promise.all([
            loadImageBuffer(accGuest.livePhoto, `guest ${idx + 2} live photo`, false),
            loadImageBuffer(accGuest.idImageFront, `guest ${idx + 2} ID front`, false),
            loadImageBuffer(accGuest.idImageBack, `guest ${idx + 2} ID back`, false),
          ]);
          return {
            name: safeText(accGuest.name, `Guest #${idx + 2}`),
            category: accGuest.category || 'Co-Occupant',
            livePhoto: accLive,
            idImageFront: accFront,
            idImageBack: accBack,
          };
        })
      ),
    ]);

  return {
    livePhoto,
    idImageFront,
    idImageBack,
    ownerSignature,
    hotelStamp,
    guestSignature,
    accompanyingGuests: accompanyingImages,
  };
};

// ============================================================
// SECTION 0: HEADER — Logo + Hotel Name + Contact + GST
// ============================================================

const drawHeader = (doc, guest) => {
  const area = getPageArea(doc);
  const headerY = area.top;

  // Left: Apna Register Logo
  let logoEndX = area.left;
  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, area.left, headerY, { fit: [78, 38], align: 'left', valign: 'center' });
      logoEndX = area.left + 86;
    } catch (error) {
      logger.warn(`Unable to load logo: ${error.message}`);
    }
  }

  // Right: Hotel Name & Metadata
  const hotelName = safeText(guest?.hotel?.hotelName || guest?.hotel?.username, 'HOTEL').toUpperCase();
  const hotelAddress = buildHotelAddress(guest?.hotel);
  const hotelPhone = safeText(guest?.hotel?.phone, '');
  const gstNumber = safeText(guest?.hotel?.gstNumber, '');

  const rightBoxWidth = area.right - logoEndX;

  doc
    .font(CONFIG.fonts.bold)
    .fontSize(CONFIG.fontSizes.hotelName)
    .fillColor(CONFIG.colors.brand)
    .text(hotelName, logoEndX, headerY + 1, {
      width: rightBoxWidth,
      align: 'right',
      lineBreak: false,
    });

  const subParts = [];
  if (hotelAddress) subParts.push(hotelAddress);
  if (hotelPhone && hotelPhone !== 'N/A') subParts.push(`Desk: ${hotelPhone}`);
  if (gstNumber && gstNumber !== 'N/A') subParts.push(`GSTIN: ${gstNumber}`);

  if (subParts.length > 0) {
    doc
      .font(CONFIG.fonts.normal)
      .fontSize(CONFIG.fontSizes.subtitle)
      .fillColor(CONFIG.colors.textSecondary)
      .text(subParts.join('  •  '), logoEndX, headerY + 19, {
        width: rightBoxWidth,
        align: 'right',
        lineBreak: false,
      });
  }

  // Bottom border line
  const sepY = headerY + 38;
  doc
    .moveTo(area.left, sepY)
    .lineTo(area.right, sepY)
    .strokeColor(CONFIG.colors.brand)
    .lineWidth(1)
    .stroke();

  doc.y = sepY + 6;
};

// ============================================================
// STATUS BAR — Verified Pill + Booking Ref + Customer ID + Timestamp
// ============================================================

const drawStatusBar = (doc, guest, bookingRef) => {
  const area = getPageArea(doc);
  const barY = doc.y;
  const barHeight = 20;

  doc
    .roundedRect(area.left, barY, area.contentWidth, barHeight, 3)
    .fillAndStroke(CONFIG.colors.cellBg, CONFIG.colors.borderLight);

  // Left: Verified & Checked-Out Pill
  const statusStr = safeText(guest?.status, 'CHECKED-OUT').toUpperCase();
  const badgeText = `✓ VERIFIED & ${statusStr}`;
  doc.font(CONFIG.fonts.bold).fontSize(CONFIG.fontSizes.badge);
  const badgeWidth = doc.widthOfString(badgeText) + 14;
  const badgeX = area.left + 6;
  const badgeY = barY + 3.5;

  doc.roundedRect(badgeX, badgeY, badgeWidth, 13, 2.5).fill(CONFIG.colors.successBg);
  doc
    .fillColor(CONFIG.colors.verifiedBadge)
    .text(badgeText, badgeX + 7, badgeY + 2.8, { lineBreak: false });

  // Right-aligned Meta Info so it never collides
  const checkoutOrNow = guest?.stayDetails?.checkOut || new Date();
  const metaText = `Booking Ref: ${bookingRef}   |   Customer ID: ${safeText(guest?.customerId)}   |   Timestamp: ${formatDateTime(checkoutOrNow)}`;

  const metaStartX = badgeX + badgeWidth + 8;
  doc
    .font(CONFIG.fonts.bold)
    .fontSize(CONFIG.fontSizes.statusBar)
    .fillColor(CONFIG.colors.textSecondary)
    .text(metaText, metaStartX, barY + 6, {
      width: area.right - metaStartX - 8,
      align: 'right',
      lineBreak: false,
    });

  doc.y = barY + barHeight + 8;
};

// ============================================================
// SECTION TITLE — Prevents Orphaned Headers via minContentHeight
// ============================================================

const drawSectionTitle = (doc, number, title, minContentHeight = 60) => {
  const barHeight = 17;
  // Ensure space for BOTH the section bar AND the minimum content height below it
  ensureSpace(doc, barHeight + 6 + minContentHeight);

  const area = getPageArea(doc);
  const barY = doc.y;

  doc
    .roundedRect(area.left, barY, area.contentWidth, barHeight, 2.5)
    .fill(CONFIG.colors.sectionBg);

  const sectionText = `${number}. ${title.toUpperCase()}`;
  doc
    .font(CONFIG.fonts.bold)
    .fontSize(CONFIG.fontSizes.sectionTitle)
    .fillColor(CONFIG.colors.sectionText)
    .text(sectionText, area.left + 8, barY + 4, {
      width: area.contentWidth - 16,
      lineBreak: false,
    });

  doc.y = barY + barHeight + 5;
};

// ============================================================
// SECTION 1: STAY ALLOCATION & BOOKING DETAILS
// ============================================================

const drawStayCell = (doc, x, y, w, h, label, value, highlight = false) => {
  doc
    .rect(x, y, w, h)
    .fillAndStroke(highlight ? CONFIG.colors.brandLight : CONFIG.colors.cardBg, CONFIG.colors.border);

  doc
    .font(CONFIG.fonts.bold)
    .fontSize(6.2)
    .fillColor(CONFIG.colors.textMuted)
    .text(label.toUpperCase(), x + 6, y + 4, { width: w - 12, lineBreak: false });

  doc
    .font(CONFIG.fonts.bold)
    .fontSize(CONFIG.fontSizes.body)
    .fillColor(highlight ? CONFIG.colors.brand : CONFIG.colors.textPrimary)
    .text(safeText(value), x + 6, y + 13, { width: w - 12, lineBreak: false });
};

const drawStaySection = (doc, guest) => {
  const rowH = 26;
  drawSectionTitle(doc, '1', 'STAY ALLOCATION & BOOKING DETAILS', rowH * 2 + 8);

  const area = getPageArea(doc);
  const startY = doc.y;
  const colW = area.contentWidth / 4;

  const actualCheckout = guest?.stayDetails?.checkOut
    ? formatDateTime(guest.stayDetails.checkOut)
    : formatDateTime(guest?.stayDetails?.expectedCheckout);

  const checkoutLabel = guest?.stayDetails?.checkOut ? 'Actual Check-Out' : 'Expected Check-Out';

  // Row 1: Room | Purpose | Check-In | Check-Out
  drawStayCell(doc, area.left, startY, colW, rowH, 'Allocated Room', `Room No. ${safeText(guest?.stayDetails?.roomNumber)}`, true);
  drawStayCell(doc, area.left + colW, startY, colW, rowH, 'Purpose of Visit', safeText(guest?.stayDetails?.purposeOfVisit));
  drawStayCell(doc, area.left + colW * 2, startY, rowH ? colW : colW, rowH, 'Check-In Date/Time', formatDateTime(guest?.stayDetails?.checkIn));
  drawStayCell(doc, area.left + colW * 3, startY, colW, rowH, checkoutLabel, actualCheckout);

  // Row 2: Occupancy | Expected Check-Out | Nationality | Verification Status
  const row2Y = startY + rowH;
  const halfW = area.contentWidth / 2;
  drawStayCell(doc, area.left, row2Y, halfW, rowH, 'Total Occupancy', getOccupancyText(guest));
  drawStayCell(
    doc,
    area.left + halfW,
    row2Y,
    halfW,
    rowH,
    'Expected Check-Out Schedule',
    formatDateTime(guest?.stayDetails?.expectedCheckout)
  );

  doc.y = row2Y + rowH + 8;
};

// ============================================================
// SECTION 2: GUEST DETAILS (Dynamic Full-Width or 2-Column Cards)
// ============================================================

const drawKeyValueRow = (doc, x, y, labelW, colW, label, value) => {
  doc
    .font(CONFIG.fonts.bold)
    .fontSize(CONFIG.fontSizes.label)
    .fillColor(CONFIG.colors.textMuted)
    .text(`${label}:`, x, y, { width: labelW, lineBreak: false });

  doc
    .font(CONFIG.fonts.normal)
    .fontSize(CONFIG.fontSizes.body)
    .fillColor(CONFIG.colors.textPrimary)
    .text(safeText(value), x + labelW + 4, y, {
      width: colW - labelW - 8,
      lineBreak: false,
      ellipsis: true,
    });
};

/**
 * Renders a single full-width compact 2-column card when there is ONLY 1 guest,
 * saving ~55pt of vertical height while looking crisp and balanced.
 */
const drawSinglePrimaryGuestCard = (doc, guest, x, y, w) => {
  const headerH = 18;
  const rowH = 13.5;
  const pad = 8;
  const bodyRows = 4; // 4 rows in 2-column layout
  const totalH = headerH + pad + bodyRows * rowH + 6;

  // Outer card
  doc.roundedRect(x, y, w, totalH, 3).fillAndStroke(CONFIG.colors.cardBg, CONFIG.colors.border);

  // Card Header
  doc.rect(x, y, w, headerH).fillAndStroke(CONFIG.colors.cardHeaderBg, CONFIG.colors.border);
  doc
    .font(CONFIG.fonts.bold)
    .fontSize(CONFIG.fontSizes.body)
    .fillColor(CONFIG.colors.brand)
    .text('GUEST #01: PRIMARY GUEST (LEAD OCCUPANT)', x + pad, y + 5, { lineBreak: false });

  // Verified Badge
  const badgeText = '✓ Primary KYC Verified';
  const badgeW = doc.font(CONFIG.fonts.bold).fontSize(6.2).widthOfString(badgeText) + 12;
  doc.roundedRect(x + w - badgeW - pad, y + 3, badgeW, 12, 2.5).fill(CONFIG.colors.successBg);
  doc
    .fillColor(CONFIG.colors.verifiedBadge)
    .text(badgeText, x + w - badgeW - pad + 6, y + 5.5, { lineBreak: false });

  // 2-Column Inner Grid
  const colW = (w - pad * 3) / 2;
  const leftX = x + pad;
  const rightX = x + pad * 2 + colW;
  const labelW = 68;
  let curY = y + headerH + 6;

  // Vertical subtle divider between left & right columns
  doc
    .moveTo(x + w / 2, y + headerH + 4)
    .lineTo(x + w / 2, y + totalH - 4)
    .strokeColor(CONFIG.colors.borderLight)
    .lineWidth(0.5)
    .stroke();

  // Row 1
  drawKeyValueRow(doc, leftX, curY, labelW, colW, 'FULL NAME', guest?.primaryGuest?.name);
  drawKeyValueRow(doc, rightX, curY, labelW, colW, 'ID DOCUMENT', `${safeText(guest?.idType)} (${maskIdNumber(guest?.idNumber)})`);
  curY += rowH;

  // Row 2
  drawKeyValueRow(doc, leftX, curY, labelW, colW, 'MOBILE NO', guest?.primaryGuest?.phone);
  drawKeyValueRow(doc, rightX, curY, labelW, colW, 'EMAIL ID', guest?.primaryGuest?.email);
  curY += rowH;

  // Row 3
  drawKeyValueRow(
    doc,
    leftX,
    curY,
    labelW,
    colW,
    'DOB / GENDER',
    formatDobWithAgeAndGender(guest?.primaryGuest?.dob, guest?.primaryGuest?.gender)
  );
  drawKeyValueRow(
    doc,
    rightX,
    curY,
    labelW,
    colW,
    'NATIONALITY',
    guest?.primaryGuest?.nationality || guest?.hotel?.nationality || 'Indian'
  );
  curY += rowH;

  // Row 4: Full-width Address
  drawKeyValueRow(doc, leftX, curY, labelW, w - pad * 2, 'ADDRESS', buildAddress(guest));

  return totalH;
};

/**
 * Renders a half-width card when there are multiple guests (2 cards side-by-side).
 */
const drawHalfGuestCard = (doc, guest, accGuest, x, y, w, cardNumber, roleLabel, isCoOccupant) => {
  const headerH = 18;
  const rowH = 13;
  const pad = 7;
  const labelW = 64;

  const fields = !isCoOccupant
    ? [
      { label: 'FULL NAME', value: guest?.primaryGuest?.name },
      { label: 'MOBILE NO', value: guest?.primaryGuest?.phone },
      { label: 'DOB / GENDER', value: formatDobWithAgeAndGender(guest?.primaryGuest?.dob, guest?.primaryGuest?.gender) },
      { label: 'NATIONALITY', value: guest?.primaryGuest?.nationality || 'Indian' },
      { label: 'ID DOCUMENT', value: `${safeText(guest?.idType)} (${maskIdNumber(guest?.idNumber)})` },
      { label: 'EMAIL', value: guest?.primaryGuest?.email },
      { label: 'ADDRESS', value: buildAddress(guest) },
    ]
    : [
      { label: 'FULL NAME', value: accGuest?.name },
      { label: 'CATEGORY', value: accGuest?.category || 'Accompanying' },
      { label: 'DOB / GENDER', value: formatDobWithAgeAndGender(accGuest?.dob, accGuest?.gender) },
      { label: 'NATIONALITY', value: guest?.primaryGuest?.nationality || 'Indian' },
      {
        label: 'ID DOCUMENT',
        value: accGuest?.idType ? `${safeText(accGuest.idType)} (${maskIdNumber(accGuest.idNumber)})` : 'Verified with Lead',
      },
      { label: 'MOBILE NO', value: accGuest?.phone || guest?.primaryGuest?.phone || 'N/A' },
      { label: 'ADDRESS', value: buildAddress(guest) },
    ];

  const totalH = headerH + pad + fields.length * rowH + 4;

  // Outer Card Border
  doc.roundedRect(x, y, w, totalH, 3).fillAndStroke(CONFIG.colors.cardBg, CONFIG.colors.border);

  // Header Bar
  doc.rect(x, y, w, headerH).fillAndStroke(CONFIG.colors.cardHeaderBg, CONFIG.colors.border);
  doc
    .font(CONFIG.fonts.bold)
    .fontSize(7.5)
    .fillColor(CONFIG.colors.brand)
    .text(`GUEST #${String(cardNumber).padStart(2, '0')}: ${roleLabel.toUpperCase()}`, x + pad, y + 5, {
      width: w - pad * 2 - 55,
      lineBreak: false,
    });

  // Verified Badge
  const badgeText = `#${String(cardNumber).padStart(2, '0')} Verified`;
  const badgeW = doc.font(CONFIG.fonts.bold).fontSize(6).widthOfString(badgeText) + 10;
  doc.roundedRect(x + w - badgeW - pad, y + 3, badgeW, 12, 2.5).fill(CONFIG.colors.successBg);
  doc
    .fillColor(CONFIG.colors.verifiedBadge)
    .text(badgeText, x + w - badgeW - pad + 5, y + 5.5, { lineBreak: false });

  let rowY = y + headerH + 6;
  const innerW = w - pad * 2;
  fields.forEach((f) => {
    drawKeyValueRow(doc, x + pad, rowY, labelW, innerW, f.label, f.value);
    rowY += rowH;
  });

  return totalH;
};

const drawGuestDetailsSection = (doc, guest) => {
  const allAccompanying = getAllAccompanyingGuests(guest);
  const hasAccompanying = allAccompanying.length > 0;
  const titleSuffix = hasAccompanying
    ? `(${1 + allAccompanying.length} OCCUPANTS REGISTERED)`
    : '(SINGLE OCCUPANT)';

  const minCardH = hasAccompanying ? 118 : 82;
  drawSectionTitle(doc, '2', `GUEST DETAILS ${titleSuffix}`, minCardH);

  const area = getPageArea(doc);
  const gap = 8;

  if (!hasAccompanying) {
    // 1 Guest -> Sleek full-width 2-column card
    const h = drawSinglePrimaryGuestCard(doc, guest, area.left, doc.y, area.contentWidth);
    doc.y += h + 8;
    return;
  }

  // Multiple Guests -> Pair them 2 per row (Guest #1 + Guest #2, then #3 + #4, etc.)
  const allGuestsList = [
    { isPrimary: true, data: null, role: 'PRIMARY (LEAD)' },
    ...allAccompanying.map((g) => ({ isPrimary: false, data: g, role: `CO-OCCUPANT (${g.category})` })),
  ];

  const colW = (area.contentWidth - gap) / 2;

  for (let i = 0; i < allGuestsList.length; i += 2) {
    ensureSpace(doc, 122);
    const rowStartY = doc.y;
    const leftGuest = allGuestsList[i];
    const rightGuest = allGuestsList[i + 1];

    const hLeft = drawHalfGuestCard(
      doc,
      guest,
      leftGuest.data,
      area.left,
      rowStartY,
      rightGuest ? colW : area.contentWidth,
      i + 1,
      leftGuest.role,
      !leftGuest.isPrimary
    );

    let hRight = 0;
    if (rightGuest) {
      hRight = drawHalfGuestCard(
        doc,
        guest,
        rightGuest.data,
        area.left + colW + gap,
        rowStartY,
        colW,
        i + 2,
        rightGuest.role,
        true
      );
    }

    doc.y = rowStartY + Math.max(hLeft, hRight) + 8;
  }
};

// ============================================================
// SECTION 3: DIGITAL KYC VERIFICATION & LIVE CAPTURE EVIDENCE
// ============================================================

const drawImagePlaceholder = (doc, x, y, width, height, text) => {
  doc
    .roundedRect(x, y, width, height, 3)
    .fillAndStroke(CONFIG.colors.placeholderBg, CONFIG.colors.borderLight);
  doc
    .font(CONFIG.fonts.italic)
    .fontSize(6.5)
    .fillColor(CONFIG.colors.textMuted)
    .text(text || 'Not Provided', x + 4, y + height / 2 - 4, {
      width: width - 8,
      align: 'center',
      lineBreak: false,
    });
};

const drawImageBox = (doc, x, y, width, height, title, imageBuffer, captionText) => {
  const headerH = 13;
  // Outer container
  doc.roundedRect(x, y, width, height, 3).fillAndStroke(CONFIG.colors.cardBg, CONFIG.colors.border);

  // Top label bar
  doc.rect(x, y, width, headerH).fillAndStroke(CONFIG.colors.cardHeaderBg, CONFIG.colors.border);
  doc
    .font(CONFIG.fonts.bold)
    .fontSize(6.2)
    .fillColor(CONFIG.colors.textSecondary)
    .text(title.toUpperCase(), x + 4, y + 3.5, {
      width: width - 8,
      align: 'center',
      lineBreak: false,
    });

  const captionReserve = captionText ? 11 : 3;
  const imgAreaY = y + headerH + 3;
  const imgAreaH = height - headerH - captionReserve - 4;
  const imgAreaW = width - 8;

  if (imageBuffer) {
    try {
      doc.image(imageBuffer, x + 4, imgAreaY, {
        fit: [imgAreaW, imgAreaH],
        align: 'center',
        valign: 'center',
      });
    } catch (error) {
      drawImagePlaceholder(doc, x + 4, imgAreaY, imgAreaW, imgAreaH, 'Image Render Error');
    }
  } else {
    drawImagePlaceholder(doc, x + 4, imgAreaY, imgAreaW, imgAreaH, 'Not Available');
  }

  if (captionText) {
    doc
      .font(CONFIG.fonts.italic)
      .fontSize(5.8)
      .fillColor(CONFIG.colors.textMuted)
      .text(captionText, x + 4, y + height - 9.5, {
        width: width - 8,
        align: 'center',
        lineBreak: false,
      });
  }
};

const drawKycSection = (doc, images, guest) => {
  const accompanying = images.accompanyingGuests || [];
  const hasAccompanying = accompanying.length > 0;
  const boxHeight = 96;

  drawSectionTitle(doc, '3', 'DIGITAL KYC VERIFICATION & LIVE CAPTURE EVIDENCE', boxHeight + 10);

  const area = getPageArea(doc);
  const gap = 8;
  const startY = doc.y;

  const primaryFirst = safeText(guest?.primaryGuest?.name, 'Guest').split(' ')[0];
  const regTime = formatTime(guest?.registrationTimestamp);
  const primaryCaption = regTime ? `${primaryFirst} • Captured ${regTime}` : primaryFirst;
  const idTypeLabel = safeText(guest?.idType, 'GOVT ID').toUpperCase();

  if (!hasAccompanying) {
    // ── SINGLE GUEST: Clean 3-Column Grid (NO Ghost Guest #2 Box!) ──
    const colW = (area.contentWidth - gap * 2) / 3;

    drawImageBox(
      doc,
      area.left,
      startY,
      colW,
      boxHeight,
      'PRIMARY GUEST: LIVE PHOTO',
      images.livePhoto,
      primaryCaption
    );
    drawImageBox(
      doc,
      area.left + colW + gap,
      startY,
      colW,
      boxHeight,
      `${idTypeLabel} (FRONT)`,
      images.idImageFront,
      maskIdNumber(guest?.idNumber)
    );
    drawImageBox(
      doc,
      area.left + (colW + gap) * 2,
      startY,
      colW,
      boxHeight,
      `${idTypeLabel} (BACK)`,
      images.idImageBack,
      'Verified Document'
    );

    doc.y = startY + boxHeight + 8;
  } else {
    // ── MULTIPLE GUESTS: 4-Column Primary + Co-Occupant Row ──
    const colW = (area.contentWidth - gap * 3) / 4;
    const firstAcc = accompanying[0];
    const firstAccName = safeText(firstAcc?.name, 'Guest 2').split(' ')[0];

    drawImageBox(
      doc,
      area.left,
      startY,
      colW,
      boxHeight,
      'GUEST #01: LIVE PHOTO',
      images.livePhoto,
      primaryCaption
    );
    drawImageBox(
      doc,
      area.left + colW + gap,
      startY,
      colW,
      boxHeight,
      'GUEST #02: LIVE PHOTO',
      firstAcc?.livePhoto,
      `${firstAccName} (${firstAcc?.category || 'Co-Guest'})`
    );
    drawImageBox(
      doc,
      area.left + (colW + gap) * 2,
      startY,
      colW,
      boxHeight,
      `GUEST #01 ${idTypeLabel} (FRONT)`,
      images.idImageFront,
      maskIdNumber(guest?.idNumber)
    );
    drawImageBox(
      doc,
      area.left + (colW + gap) * 3,
      startY,
      colW,
      boxHeight,
      `GUEST #01 ${idTypeLabel} (BACK)`,
      images.idImageBack,
      'Verified Document'
    );

    doc.y = startY + boxHeight + 8;

    // If Guest #2 also uploaded ID Front/Back or if there are Guests #3, #4...
    const extraKycRows = [];

    if (firstAcc?.idImageFront || firstAcc?.idImageBack) {
      extraKycRows.push({
        guestNum: 2,
        name: firstAcc.name,
        livePhoto: firstAcc.livePhoto,
        idImageFront: firstAcc.idImageFront,
        idImageBack: firstAcc.idImageBack,
      });
    }

    for (let i = 1; i < accompanying.length; i++) {
      const acc = accompanying[i];
      if (acc.livePhoto || acc.idImageFront || acc.idImageBack) {
        extraKycRows.push({
          guestNum: i + 2,
          name: acc.name,
          livePhoto: acc.livePhoto,
          idImageFront: acc.idImageFront,
          idImageBack: acc.idImageBack,
        });
      }
    }

    const accColW = (area.contentWidth - gap * 2) / 3;
    for (const row of extraKycRows) {
      ensureSpace(doc, boxHeight + 8);
      const rowY = doc.y;
      const gTag = `GUEST #${String(row.guestNum).padStart(2, '0')} (${safeText(row.name).split(' ')[0].toUpperCase()})`;

      drawImageBox(doc, area.left, rowY, accColW, boxHeight, `${gTag}: LIVE PHOTO`, row.livePhoto);
      drawImageBox(doc, area.left + accColW + gap, rowY, accColW, boxHeight, `${gTag}: ID FRONT`, row.idImageFront);
      drawImageBox(doc, area.left + (accColW + gap) * 2, rowY, accColW, boxHeight, `${gTag}: ID BACK`, row.idImageBack);

      doc.y = rowY + boxHeight + 8;
    }
  }
};

// ============================================================
// SECTION 4: HOTEL VERIFICATION & AUTHORIZATION
// ============================================================

const drawAuthorizationSection = (doc, images, guest) => {
  const sectionHeight = 84;
  drawSectionTitle(doc, '4', 'HOTEL VERIFICATION & AUTHORIZATION', sectionHeight + 8);

  const area = getPageArea(doc);
  const startY = doc.y;

  const hasGuestConsentSig = Boolean(images.guestSignature);
  const numCols = hasGuestConsentSig ? 3 : 2;
  const colW = area.contentWidth / numCols;

  // Outer container
  doc.roundedRect(area.left, startY, area.contentWidth, sectionHeight, 3)
    .fillAndStroke(CONFIG.colors.cardBg, CONFIG.colors.border);

  // ── Column 1: Hotel Official Stamp ──
  doc
    .font(CONFIG.fonts.bold)
    .fontSize(6.5)
    .fillColor(CONFIG.colors.textMuted)
    .text('HOTEL OFFICIAL STAMP', area.left + 8, startY + 6, { width: colW - 16, align: 'center', lineBreak: false });

  if (images.hotelStamp) {
    try {
      doc.image(images.hotelStamp, area.left + 12, startY + 16, {
        fit: [colW - 24, sectionHeight - 32],
        align: 'center',
        valign: 'center',
      });
    } catch (e) {
      drawImagePlaceholder(doc, area.left + 12, startY + 18, colW - 24, sectionHeight - 34, 'Stamp Load Error');
    }
  } else {
    // Sleek digital verification stamp fallback if hotel hasn't uploaded a stamp image
    const hotelTitle = safeText(guest?.hotel?.hotelName, 'Verified Hotel').toUpperCase();
    doc
      .roundedRect(area.left + 20, startY + 22, colW - 40, 38, 3)
      .lineWidth(0.8)
      .dash(3, { space: 2 })
      .strokeColor(CONFIG.colors.brandAccent)
      .stroke()
      .undash();
    doc
      .font(CONFIG.fonts.bold)
      .fontSize(7)
      .fillColor(CONFIG.colors.brand)
      .text(hotelTitle, area.left + 24, startY + 30, { width: colW - 48, align: 'center', lineBreak: false });
    doc
      .font(CONFIG.fonts.normal)
      .fontSize(6)
      .fillColor(CONFIG.colors.verifiedBadge)
      .text('✓ DIGITALLY VERIFIED SEAL', area.left + 24, startY + 42, { width: colW - 48, align: 'center', lineBreak: false });
  }

  doc
    .font(CONFIG.fonts.normal)
    .fontSize(6)
    .fillColor(CONFIG.colors.textMuted)
    .text('Official Establishment Seal', area.left + 8, startY + sectionHeight - 12, {
      width: colW - 16,
      align: 'center',
      lineBreak: false,
    });

  // Divider 1
  doc
    .moveTo(area.left + colW, startY)
    .lineTo(area.left + colW, startY + sectionHeight)
    .strokeColor(CONFIG.colors.border)
    .lineWidth(0.5)
    .stroke();

  // ── Column 2 (optional): Primary Guest Signature (if captured via DPDP consent) ──
  if (hasGuestConsentSig) {
    const col2X = area.left + colW;
    doc
      .font(CONFIG.fonts.bold)
      .fontSize(6.5)
      .fillColor(CONFIG.colors.textMuted)
      .text('PRIMARY GUEST SIGNATURE', col2X + 8, startY + 6, { width: colW - 16, align: 'center', lineBreak: false });

    try {
      doc.image(images.guestSignature, col2X + 14, startY + 18, {
        fit: [colW - 28, sectionHeight - 38],
        align: 'center',
        valign: 'center',
      });
    } catch (e) {
      // Ignore error
    }

    doc
      .moveTo(col2X + 20, startY + sectionHeight - 16)
      .lineTo(col2X + colW - 20, startY + sectionHeight - 16)
      .strokeColor(CONFIG.colors.border)
      .lineWidth(0.4)
      .stroke();

    doc
      .font(CONFIG.fonts.normal)
      .fontSize(6)
      .fillColor(CONFIG.colors.textSecondary)
      .text(safeText(guest?.primaryGuest?.name, 'Guest Signature'), col2X + 8, startY + sectionHeight - 12, {
        width: colW - 16,
        align: 'center',
        lineBreak: false,
      });

    // Divider 2
    doc
      .moveTo(area.left + colW * 2, startY)
      .lineTo(area.left + colW * 2, startY + sectionHeight)
      .strokeColor(CONFIG.colors.border)
      .lineWidth(0.5)
      .stroke();
  }

  // ── Last Column: Hotel Owner / Authorized Signatory ──
  const sigColX = area.left + colW * (numCols - 1);
  doc
    .font(CONFIG.fonts.bold)
    .fontSize(6.5)
    .fillColor(CONFIG.colors.textMuted)
    .text('AUTHORIZED SIGNATORY', sigColX + 8, startY + 6, { width: colW - 16, align: 'center', lineBreak: false });

  if (images.ownerSignature) {
    try {
      doc.image(images.ownerSignature, sigColX + 14, startY + 16, {
        fit: [colW - 28, sectionHeight - 36],
        align: 'center',
        valign: 'center',
      });
    } catch (e) {
      logger.warn(`Unable to embed ownerSignature: ${e.message}`);
    }
  } else {
    const ownerName = safeText(guest?.hotel?.ownerName || guest?.hotel?.hotelName, 'Authorized Signatory');
    doc
      .font(CONFIG.fonts.italic)
      .fontSize(9)
      .fillColor(CONFIG.colors.brand)
      .text(`Sd/- ${ownerName}`, sigColX + 12, startY + 34, {
        width: colW - 24,
        align: 'center',
        lineBreak: false,
      });
  }

  doc
    .moveTo(sigColX + 20, startY + sectionHeight - 16)
    .lineTo(sigColX + colW - 20, startY + sectionHeight - 16)
    .strokeColor(CONFIG.colors.border)
    .lineWidth(0.4)
    .stroke();

  doc
    .font(CONFIG.fonts.normal)
    .fontSize(6)
    .fillColor(CONFIG.colors.textSecondary)
    .text('Hotel Owner / Authorized Signatory', sigColX + 8, startY + sectionHeight - 12, {
      width: colW - 16,
      align: 'center',
      lineBreak: false,
    });

  doc.y = startY + sectionHeight + 8;
};

// ============================================================
// GUEST DECLARATION & HOTEL REGULATIONS
// ============================================================

const drawDeclaration = (doc) => {
  const rules = [
    '1. I/We declare that all furnished identity details are authentic and certified under Section 193 of the Indian Penal Code.',
    '2. Standard Check-In: 12:00 PM | Standard Check-Out: 11:00 AM. Extra tariff applies on unapproved delay.',
    '3. Weapons, illicit contraband, or consumption of prohibited intoxicants is strictly banned inside premises.',
    '4. Hotel authority shall not be held liable for unsecured cash or precious items kept outside personal safe lockers.',
  ];
  const ruleBoxH = rules.length * 10 + 10;

  ensureSpace(doc, ruleBoxH + 18);
  const area = getPageArea(doc);
  const startY = doc.y;

  doc
    .font(CONFIG.fonts.bold)
    .fontSize(7.2)
    .fillColor(CONFIG.colors.brand)
    .text('GUEST DECLARATION & HOTEL REGULATIONS', area.left, startY, { lineBreak: false });

  const boxY = startY + 11;
  doc
    .roundedRect(area.left, boxY, area.contentWidth, ruleBoxH, 3)
    .fillAndStroke(CONFIG.colors.declarationBg, CONFIG.colors.borderLight);

  let ruleY = boxY + 5;
  rules.forEach((rule) => {
    doc
      .font(CONFIG.fonts.normal)
      .fontSize(6.2)
      .fillColor(CONFIG.colors.textSecondary)
      .text(rule, area.left + 8, ruleY, { width: area.contentWidth - 16, lineBreak: false });
    ruleY += 10;
  });

  doc.y = boxY + ruleBoxH + 4;
};

// ============================================================
// FOOTER — Hotel brand + Powered by Apna Register
// ============================================================

const addPageFooters = (doc, guest, bookingRef) => {
  const pageRange = doc.bufferedPageRange();
  const hotelName = safeText(guest?.hotel?.hotelName || guest?.hotel?.username, 'Hotel');

  for (let i = 0; i < pageRange.count; i++) {
    doc.switchToPage(i);
    const area = getPageArea(doc);
    const lineY = doc.page.height - CONFIG.margin - 14;

    doc
      .moveTo(area.left, lineY)
      .lineTo(area.right, lineY)
      .strokeColor(CONFIG.colors.divider)
      .lineWidth(0.5)
      .stroke();

    doc
      .font(CONFIG.fonts.bold)
      .fontSize(CONFIG.fontSizes.footer)
      .fillColor(CONFIG.colors.textMuted)
      .text(hotelName, area.left, lineY + 4, { width: 180, lineBreak: false });

    doc
      .font(CONFIG.fonts.normal)
      .fontSize(CONFIG.fontSizes.footer)
      .fillColor(CONFIG.colors.textMuted)
      .text(`Ref: ${bookingRef}  •  Powered by Apna Register`, area.left, lineY + 4, {
        width: area.contentWidth,
        align: 'center',
        lineBreak: false,
      });

    doc
      .font(CONFIG.fonts.normal)
      .fontSize(CONFIG.fontSizes.footer)
      .fillColor(CONFIG.colors.textMuted)
      .text(`Page ${i + 1} of ${pageRange.count}`, area.left, lineY + 4, {
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
  const bookingRef = buildBookingRef(guestData);

  registerPageDecorators(doc);

  const images = await loadReceiptImages(guestData);

  // Section 0: Header
  drawHeader(doc, guestData);

  // Status Bar
  drawStatusBar(doc, guestData, bookingRef);

  // Section 1: Stay Allocation & Booking Details
  drawStaySection(doc, guestData);

  // Section 2: Guest Details (Dynamic 1-Guest Full Width or 2-Up Grid)
  drawGuestDetailsSection(doc, guestData);

  // Section 3: Digital KYC Verification (Dynamic 3-Col for 1 Guest, 4-Col + Rows for Multi-Guest)
  drawKycSection(doc, images, guestData);

  // Section 4: Hotel Verification & Authorization
  drawAuthorizationSection(doc, images, guestData);

  // Declaration
  drawDeclaration(doc);

  // Footers
  addPageFooters(doc, guestData, bookingRef);
  doc.end();

  return outputPromise;
};

// ============================================================
// FALLBACK PDF
// ============================================================

const renderFallbackPdf = async (guestData, sourceError) => {
  const doc = createPdfDoc();
  const outputPromise = collectPdfBuffer(doc);
  const bookingRef = buildBookingRef(guestData);

  registerPageDecorators(doc);
  drawHeader(doc, guestData);

  drawSectionTitle(doc, '1', 'GUEST INFORMATION', 80);
  const area = getPageArea(doc);

  const fields = [
    { label: 'Guest Name', value: guestData?.primaryGuest?.name },
    { label: 'Customer ID', value: guestData?.customerId },
    { label: 'Hotel', value: guestData?.hotel?.hotelName || guestData?.hotel?.username },
    { label: 'Checkout Time', value: formatDateTime(guestData?.stayDetails?.checkOut || new Date()) },
  ];

  fields.forEach((f) => {
    doc
      .font(CONFIG.fonts.bold)
      .fontSize(CONFIG.fontSizes.label)
      .fillColor(CONFIG.colors.textMuted)
      .text(`${f.label}:`, area.left, doc.y, { continued: true, width: 100 });
    doc
      .font(CONFIG.fonts.normal)
      .fontSize(CONFIG.fontSizes.body)
      .fillColor(CONFIG.colors.textPrimary)
      .text(`  ${safeText(f.value)}`);
    doc.moveDown(0.3);
  });

  doc.moveDown(0.5);
  doc
    .font(CONFIG.fonts.italic)
    .fontSize(CONFIG.fontSizes.small)
    .fillColor(CONFIG.colors.textMuted)
    .text(
      `Detailed rendering was unavailable. Reference ${bookingRef}. Reason: ${safeText(sourceError?.message, 'Unknown')}`,
      { width: area.contentWidth }
    );

  addPageFooters(doc, guestData, bookingRef);
  doc.end();

  return outputPromise;
};

// ============================================================
// PUBLIC API
// ============================================================

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