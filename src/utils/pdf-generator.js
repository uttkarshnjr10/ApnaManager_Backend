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
// CONFIGURATION — Matching the professional template design
// ============================================================

const CONFIG = {
  size: 'A4',
  margin: 30,
  footerReserve: 50,
  fonts: {
    bold: 'Helvetica-Bold',
    normal: 'Helvetica',
    italic: 'Helvetica-Oblique',
  },
  fontSizes: {
    hotelName: 16,
    subtitle: 8,
    sectionTitle: 10,
    body: 8,
    label: 7.5,
    small: 7,
    footer: 6.5,
    watermark: 64,
    badge: 7,
    statusBar: 7.5,
  },
  colors: {
    brand: '#1a3a5c',
    brandLight: '#e8f0fe',
    brandAccent: '#2563eb',
    sectionBg: '#1a3a5c',
    sectionText: '#ffffff',
    textPrimary: '#1a1a2e',
    textSecondary: '#4a5568',
    textMuted: '#718096',
    border: '#d1d5db',
    borderLight: '#e5e7eb',
    divider: '#e2e8f0',
    cardBg: '#ffffff',
    cellBg: '#f8fafc',
    successGreen: '#16a34a',
    successBg: '#dcfce7',
    verifiedBadge: '#15803d',
    placeholderBg: '#f0f4f8',
    watermark: '#a0aec0',
    stampBorder: '#94a3b8',
    declarationBg: '#f8fafc',
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

const formatDobWithAge = (dob) => {
  const dateStr = formatDate(dob);
  if (dateStr === 'N/A') return dateStr;
  const age = calculateAge(dob);
  if (age !== null) {
    return `${dateStr} (${age} Yrs)`;
  }
  return dateStr;
};

const formatDobWithAgeAndGender = (dob, gender) => {
  const dateStr = formatDate(dob);
  if (dateStr === 'N/A') return dateStr;
  const age = calculateAge(dob);
  const parts = [dateStr];
  if (age !== null) parts.push(`(${age} Yrs)`);
  if (gender) parts.push(`• ${gender}`);
  return parts.join(' ');
};

const maskIdNumber = (idNumber) => {
  const value = safeText(idNumber, 'N/A');
  if (value === 'N/A') return value;
  if (value.length <= 6) return value;
  const prefix = value.slice(0, 4);
  const suffix = value.slice(-4);
  const masked = 'X'.repeat(Math.max(0, value.length - 8));
  return `${prefix}-${masked}-${suffix}`;
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

const buildBookingRef = (guest) => {
  const source = [
    safeText(guest?.customerId, ''),
    safeText(guest?._id, ''),
    safeText(guest?.stayDetails?.checkIn, ''),
  ].join('|');
  return `GP-${crypto.createHash('sha256').update(source).digest('hex').slice(0, 12).toUpperCase()}`;
};

const getOccupancyText = (guest) => {
  const adults = Array.isArray(guest?.accompanyingGuests?.adults) ? guest.accompanyingGuests.adults.length : 0;
  const children = Array.isArray(guest?.accompanyingGuests?.children) ? guest.accompanyingGuests.children.length : 0;
  const totalPeople = 1 + adults + children; // primary + accompanying
  const parts = [];
  parts.push(`${totalPeople} ${totalPeople === 1 ? 'Person' : 'People'}`);
  if (adults > 0 || children > 0) {
    const detail = [];
    detail.push(`${1 + adults} Adults`);
    if (children > 0) detail.push(`${children} Children`);
    parts.push(`(${detail.join(', ')})`);
  }
  return parts.join(' ');
};

// ============================================================
// PDF DOCUMENT SETUP
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
      Author: 'Apna Register',
      Subject: 'Official guest checkout summary',
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

  const textWidth = doc.widthOfString('Apna Register');
  const textX = centerX - textWidth / 2;

  doc.rotate(-35, { origin: [centerX, centerY] });
  doc.text('Apna Register', textX, centerY - 20, { lineBreak: false });
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
// IMAGE HANDLING — Secure signed URL flow
// ============================================================

const normalizeImageField = (field) => {
  if (!field) return {};
  if (typeof field === 'string') return { url: field };
  if (typeof field === 'object') return field;
  return {};
};

const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value);

const getImageCandidates = (field) => {
  const normalized = normalizeImageField(field);
  const urls = [];
  if (normalized.public_id) {
    try {
      const signedUrl = generateSignedUrl(normalized.public_id);
      if (isHttpUrl(signedUrl)) urls.push(signedUrl);
    } catch (error) {
      logger.warn(`Failed to generate signed URL: ${error.message}`);
    }
  }
  if (isHttpUrl(normalized.url)) urls.push(normalized.url);
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
  if (!inputBuffer.length) throw new Error('Empty image data');
  return sharp(inputBuffer)
    .rotate()
    .resize(CONFIG.image.maxDimension, CONFIG.image.maxDimension, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: CONFIG.image.quality })
    .toBuffer();
};

const loadImageBuffer = async (field, label) => {
  const candidates = getImageCandidates(field);
  if (!candidates.length) return null;
  for (const candidate of candidates) {
    try { return await fetchAndOptimizeImage(candidate); }
    catch (error) { logger.warn(`Unable to load ${label} image: ${error.message}`); }
  }
  return null;
};

const loadReceiptImages = async (guest) => {
  const [livePhoto, idImageFront, idImageBack, ownerSignature, hotelStamp] = await Promise.all([
    loadImageBuffer(guest?.livePhoto, 'live photo'),
    loadImageBuffer(guest?.idImageFront, 'ID front'),
    loadImageBuffer(guest?.idImageBack, 'ID back'),
    loadImageBuffer(guest?.hotel?.ownerSignature, 'owner signature'),
    loadImageBuffer(guest?.hotel?.hotelStamp, 'hotel stamp'),
  ]);

  // Load accompanying guest images
  const loadAccImages = async (guests) => {
    if (!guests || !Array.isArray(guests)) return [];
    return Promise.all(
      guests.map(async (accGuest) => {
        const [accLivePhoto, accIdFront, accIdBack] = await Promise.all([
          loadImageBuffer(accGuest.livePhoto, `${accGuest.name} live photo`),
          loadImageBuffer(accGuest.idImageFront, `${accGuest.name} ID front`),
          loadImageBuffer(accGuest.idImageBack, `${accGuest.name} ID back`),
        ]);
        return { name: accGuest.name, images: { livePhoto: accLivePhoto, idImageFront: accIdFront, idImageBack: accIdBack } };
      })
    );
  };

  const accompanyingAdults = await loadAccImages(guest?.accompanyingGuests?.adults);
  const accompanyingChildren = await loadAccImages(guest?.accompanyingGuests?.children);

  return { livePhoto, idImageFront, idImageBack, ownerSignature, hotelStamp, accompanyingGuests: [...accompanyingAdults, ...accompanyingChildren] };
};

// ============================================================
// SECTION 0: HEADER — Logo + Hotel Name + Contact
// ============================================================

const drawHeader = (doc, guest, bookingRef) => {
  const area = getPageArea(doc);
  const headerY = area.top;

  // ── Left: Logo ──
  let logoEndX = area.left;
  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, area.left, headerY, { fit: [80, 50], align: 'center', valign: 'center' });
      logoEndX = area.left + 88;
    } catch (error) {
      logger.warn(`Unable to load logo: ${error.message}`);
    }
  }

  // ── Right: Hotel Name + Details ──
  const hotelName = safeText(guest?.hotel?.hotelName || guest?.hotel?.username, 'Hotel').toUpperCase();
  const hotelAddress = buildHotelAddress(guest?.hotel);
  const hotelPhone = safeText(guest?.hotel?.phone, '');
  const gstNumber = safeText(guest?.hotel?.gstNumber, '');

  doc.font(CONFIG.fonts.bold).fontSize(CONFIG.fontSizes.hotelName).fillColor(CONFIG.colors.brand)
    .text(hotelName, logoEndX, headerY + 2, { width: area.right - logoEndX, align: 'right', lineBreak: false });

  // Sub-details line
  const subParts = [];
  if (hotelAddress) subParts.push(hotelAddress);
  if (hotelPhone) subParts.push(`Desk: ${hotelPhone}`);
  if (gstNumber && gstNumber !== 'N/A') subParts.push(`GSTIN: ${gstNumber}`);
  
  if (subParts.length > 0) {
    doc.font(CONFIG.fonts.normal).fontSize(CONFIG.fontSizes.small).fillColor(CONFIG.colors.textSecondary)
      .text(subParts.join(' | '), logoEndX, headerY + 20, { width: area.right - logoEndX, align: 'right' });
  }

  // ── Separator ──
  const sepY = headerY + 42;
  doc.moveTo(area.left, sepY).lineTo(area.right, sepY).strokeColor(CONFIG.colors.border).lineWidth(0.5).stroke();
  doc.y = sepY + 4;
};

// ============================================================
// STATUS BAR — Verified badge + Booking Ref + Customer ID + Timestamp
// ============================================================

const drawStatusBar = (doc, guest, bookingRef) => {
  const area = getPageArea(doc);
  const barY = doc.y;
  const barHeight = 22;

  // Background bar
  doc.roundedRect(area.left, barY, area.contentWidth, barHeight, 4)
    .fill(CONFIG.colors.cellBg);
  doc.roundedRect(area.left, barY, area.contentWidth, barHeight, 4)
    .lineWidth(0.5).strokeColor(CONFIG.colors.borderLight).stroke();

  // ── Green verified badge ──
  const badgeText = `✓ VERIFIED & ${safeText(guest?.status, 'CHECKED-OUT').toUpperCase()}`;
  const badgeWidth = doc.font(CONFIG.fonts.bold).fontSize(CONFIG.fontSizes.badge).widthOfString(badgeText) + 16;
  const badgeX = area.left + 8;
  const badgeY = barY + 4;

  doc.roundedRect(badgeX, badgeY, badgeWidth, 14, 3).fill(CONFIG.colors.successBg);
  doc.font(CONFIG.fonts.bold).fontSize(CONFIG.fontSizes.badge).fillColor(CONFIG.colors.verifiedBadge)
    .text(badgeText, badgeX + 8, badgeY + 3, { lineBreak: false });

  // ── Meta items ──
  const metaItems = [
    { label: 'Booking Ref:', value: bookingRef },
    { label: 'Customer ID:', value: safeText(guest?.customerId) },
    { label: 'Timestamp:', value: formatDateTime(new Date()) },
  ];

  let metaX = badgeX + badgeWidth + 20;
  metaItems.forEach((item) => {
    const labelW = doc.font(CONFIG.fonts.bold).fontSize(CONFIG.fontSizes.statusBar).widthOfString(item.label);
    doc.font(CONFIG.fonts.bold).fontSize(CONFIG.fontSizes.statusBar).fillColor(CONFIG.colors.textMuted)
      .text(item.label, metaX, barY + 6, { lineBreak: false });
    
    const valW = doc.font(CONFIG.fonts.normal).fontSize(CONFIG.fontSizes.statusBar).widthOfString(item.value);
    doc.font(CONFIG.fonts.normal).fontSize(CONFIG.fontSizes.statusBar).fillColor(CONFIG.colors.textPrimary)
      .text(item.value, metaX + labelW + 4, barY + 6, { lineBreak: false });
    
    metaX += labelW + valW + 18;
  });

  doc.y = barY + barHeight + 10;
};

// ============================================================
// SECTION TITLE — Dark bar with white text (matching template)
// ============================================================

const drawSectionTitle = (doc, number, title) => {
  ensureSpace(doc, 30);
  const area = getPageArea(doc);
  const barY = doc.y;
  const barHeight = 20;

  // Dark navy background
  doc.roundedRect(area.left, barY, area.contentWidth, barHeight, 3)
    .fill(CONFIG.colors.sectionBg);

  // Section text
  const sectionText = `${number}. ${title.toUpperCase()}`;
  doc.font(CONFIG.fonts.bold).fontSize(CONFIG.fontSizes.sectionTitle).fillColor(CONFIG.colors.sectionText)
    .text(sectionText, area.left + 10, barY + 5, { width: area.contentWidth - 20, lineBreak: false });

  doc.y = barY + barHeight + 8;
};

// ============================================================
// BORDERED CELL — Individual data cell with label and value
// ============================================================

const drawBorderedCell = (doc, x, y, w, h, label, value) => {
  // Cell border
  doc.rect(x, y, w, h).lineWidth(0.5).strokeColor(CONFIG.colors.border).stroke();

  // Label
  doc.font(CONFIG.fonts.bold).fontSize(6.5).fillColor(CONFIG.colors.textMuted)
    .text(label.toUpperCase(), x + 6, y + 4, { width: w - 12, lineBreak: false });

  // Value
  doc.font(CONFIG.fonts.bold).fontSize(CONFIG.fontSizes.body).fillColor(CONFIG.colors.textPrimary)
    .text(safeText(value), x + 6, y + 14, { width: w - 12 });
};

// ============================================================
// SECTION 1: STAY ALLOCATION & BOOKING DETAILS
// ============================================================

const drawStaySection = (doc, guest) => {
  drawSectionTitle(doc, '1', 'STAY ALLOCATION & BOOKING DETAILS');
  const area = getPageArea(doc);
  const startY = doc.y;
  const cellHeight = 34;
  const colW = area.contentWidth / 4;

  // Row 1
  drawBorderedCell(doc, area.left, startY, colW, cellHeight, 'Allocated Room', `Room No. ${safeText(guest?.stayDetails?.roomNumber)}`);
  drawBorderedCell(doc, area.left + colW, startY, colW, cellHeight, 'Room Category', 'Standard');
  drawBorderedCell(doc, area.left + colW * 2, startY, colW, cellHeight, 'Expected Check-Out', formatDateTime(guest?.stayDetails?.expectedCheckout));
  drawBorderedCell(doc, area.left + colW * 3, startY, colW, cellHeight, 'Check-In Date/Time', formatDateTime(guest?.stayDetails?.checkIn));

  // Row 2
  const row2Y = startY + cellHeight;
  const halfW = area.contentWidth / 2;
  drawBorderedCell(doc, area.left, row2Y, halfW, cellHeight, 'Purpose of Visit', safeText(guest?.stayDetails?.purposeOfVisit));
  drawBorderedCell(doc, area.left + halfW, row2Y, halfW, cellHeight, 'Total Occupancy', getOccupancyText(guest));

  doc.y = row2Y + cellHeight + 10;
};

// ============================================================
// SECTION 2: GUEST DETAILS (Primary + Co-Occupants side by side)
// ============================================================

const drawGuestLabelValue = (doc, x, y, labelWidth, label, value, maxWidth) => {
  doc.font(CONFIG.fonts.bold).fontSize(CONFIG.fontSizes.label).fillColor(CONFIG.colors.textMuted)
    .text(`${label}:`, x, y, { width: labelWidth, lineBreak: false });
  doc.font(CONFIG.fonts.normal).fontSize(CONFIG.fontSizes.body).fillColor(CONFIG.colors.textPrimary)
    .text(safeText(value), x + labelWidth + 4, y, { width: maxWidth - labelWidth - 4 });
};

const drawGuestCard = (doc, guest, guestData, x, y, w, cardNumber, label, isCoOccupant = false) => {
  const labelWidth = 72;
  const rowHeight = 14;
  const padding = 8;

  // Card border
  doc.rect(x, y, w, 10).lineWidth(0.5).strokeColor(CONFIG.colors.border).stroke(); // placeholder for dynamic height

  // Header row with guest number
  const headerY = y;
  const headerH = 18;
  doc.rect(x, headerY, w, headerH).lineWidth(0.5).strokeColor(CONFIG.colors.border).stroke();

  // Guest title
  doc.font(CONFIG.fonts.bold).fontSize(CONFIG.fontSizes.body).fillColor(CONFIG.colors.textPrimary)
    .text(`GUEST #${String(cardNumber).padStart(2, '0')}: ${label.toUpperCase()}`, x + padding, headerY + 5, { width: w - padding * 2 - 60, lineBreak: false });

  // Verified badge
  const badgeText = `#${String(cardNumber).padStart(2, '0')} Verified`;
  const badgeW = doc.font(CONFIG.fonts.bold).fontSize(6).widthOfString(badgeText) + 12;
  doc.roundedRect(x + w - badgeW - padding, headerY + 4, badgeW, 12, 3).fill(CONFIG.colors.successBg);
  doc.font(CONFIG.fonts.bold).fontSize(6).fillColor(CONFIG.colors.verifiedBadge)
    .text(badgeText, x + w - badgeW - padding + 6, headerY + 7, { lineBreak: false });

  // Guest details rows
  let rowY = headerY + headerH + padding;
  const innerW = w - padding * 2;

  if (!isCoOccupant) {
    // Primary guest details
    const fields = [
      { label: 'FULL NAME', value: guest?.primaryGuest?.name },
      { label: 'MOBILE NO', value: guest?.primaryGuest?.phone },
      { label: 'DOB / GENDER', value: formatDobWithAgeAndGender(guest?.primaryGuest?.dob, guest?.primaryGuest?.gender) },
      { label: 'NATIONALITY', value: guest?.primaryGuest?.nationality || guest?.hotel?.nationality || 'Indian' },
      { label: 'ID DOCUMENT', value: `${safeText(guest?.idType)} (${maskIdNumber(guest?.idNumber)})` },
      { label: 'EMAIL', value: guest?.primaryGuest?.email },
      { label: 'ADDRESS', value: buildAddress(guest) },
    ];

    fields.forEach((field) => {
      drawGuestLabelValue(doc, x + padding, rowY, labelWidth, field.label, field.value, innerW);
      rowY += rowHeight;
    });
  } else {
    // Co-occupant (accompanying guest)
    const fields = [
      { label: 'FULL NAME', value: guestData?.name },
      { label: 'MOBILE NO', value: guestData?.phone || 'N/A' },
      { label: 'DOB / GENDER', value: formatDobWithAgeAndGender(guestData?.dob, guestData?.gender) },
      { label: 'NATIONALITY', value: 'Indian' },
      { label: 'ID DOCUMENT', value: guestData?.idType ? `${safeText(guestData.idType)} (${maskIdNumber(guestData.idNumber)})` : 'N/A' },
      { label: 'RELATION', value: 'Colleague / Co-Traveller' },
      { label: 'ADDRESS', value: buildAddress(guest) },
    ];

    fields.forEach((field) => {
      drawGuestLabelValue(doc, x + padding, rowY, labelWidth, field.label, field.value, innerW);
      rowY += rowHeight;
    });
  }

  const totalHeight = rowY - y + padding;
  // Redraw the outer card border with correct height
  doc.rect(x, y, w, totalHeight).lineWidth(0.5).strokeColor(CONFIG.colors.border).stroke();

  return totalHeight;
};

const drawGuestDetailsSection = (doc, guest) => {
  const adults = Array.isArray(guest?.accompanyingGuests?.adults) ? guest.accompanyingGuests.adults : [];
  const children = Array.isArray(guest?.accompanyingGuests?.children) ? guest.accompanyingGuests.children : [];
  const allAccompanying = [...adults, ...children];

  const hasAccompanying = allAccompanying.length > 0;
  const titleSuffix = hasAccompanying ? '(MULTIPLE OCCUPANTS)' : '(SINGLE OCCUPANT)';
  drawSectionTitle(doc, '2', `GUEST DETAILS ${titleSuffix}`);

  const area = getPageArea(doc);
  const gap = 8;

  if (hasAccompanying) {
    // Side-by-side: primary + first co-occupant
    const colW = (area.contentWidth - gap) / 2;
    const startY = doc.y;

    ensureSpace(doc, 180);
    const primaryHeight = drawGuestCard(doc, guest, null, area.left, doc.y, colW, 1, 'PRIMARY (LEAD)', false);
    const coHeight = drawGuestCard(doc, guest, allAccompanying[0], area.left + colW + gap, startY, colW, 2, 'CO-OCCUPANT', true);

    doc.y = startY + Math.max(primaryHeight, coHeight) + 10;

    // Additional accompanying guests (if more than 1)
    for (let i = 1; i < allAccompanying.length; i++) {
      ensureSpace(doc, 180);
      const h = drawGuestCard(doc, guest, allAccompanying[i], area.left, doc.y, area.contentWidth, i + 2, 'CO-OCCUPANT', true);
      doc.y += h + 10;
    }
  } else {
    // Single guest — full width
    ensureSpace(doc, 180);
    const h = drawGuestCard(doc, guest, null, area.left, doc.y, area.contentWidth, 1, 'PRIMARY (LEAD)', false);
    doc.y += h + 10;
  }
};

// ============================================================
// SECTION 3: DIGITAL KYC VERIFICATION & LIVE CAPTURE EVIDENCE
// ============================================================

const drawImagePlaceholder = (doc, x, y, width, height, text) => {
  doc.rect(x, y, width, height).fillAndStroke(CONFIG.colors.placeholderBg, CONFIG.colors.border);
  doc.font(CONFIG.fonts.italic).fontSize(7).fillColor(CONFIG.colors.textMuted)
    .text(text || 'Not Available', x + 4, y + height / 2 - 6, { width: width - 8, align: 'center' });
};

const drawImageBox = (doc, x, y, width, height, title, imageBuffer, captionText) => {
  // Title
  doc.font(CONFIG.fonts.bold).fontSize(6.5).fillColor(CONFIG.colors.textMuted)
    .text(title.toUpperCase(), x, y, { width: width, align: 'center', lineBreak: false });

  const imgY = y + 12;
  const imgH = height - 12;

  // Border
  doc.roundedRect(x, imgY, width, imgH, 4).lineWidth(0.5).strokeColor(CONFIG.colors.border).stroke();

  if (imageBuffer) {
    try {
      doc.image(imageBuffer, x + 4, imgY + 4, { fit: [width - 8, imgH - 8], align: 'center', valign: 'center' });
    } catch (error) {
      drawImagePlaceholder(doc, x + 2, imgY + 2, width - 4, imgH - 4, 'Image Error');
    }
  } else {
    drawImagePlaceholder(doc, x + 2, imgY + 2, width - 4, imgH - 4);
  }

  // Caption below image
  if (captionText) {
    doc.font(CONFIG.fonts.italic).fontSize(6).fillColor(CONFIG.colors.textMuted)
      .text(captionText, x, imgY + imgH + 2, { width: width, align: 'center', lineBreak: false });
  }
};

const drawKycSection = (doc, images, guest) => {
  drawSectionTitle(doc, '3', 'DIGITAL KYC VERIFICATION & LIVE CAPTURE EVIDENCE');
  ensureSpace(doc, 160);

  const area = getPageArea(doc);
  const gap = 8;
  const colW = (area.contentWidth - gap * 3) / 4;
  const boxHeight = 110;
  const startY = doc.y;

  const primaryName = safeText(guest?.primaryGuest?.name, 'Guest');
  const primaryTime = formatTime(guest?.registrationTimestamp);

  // 4-column layout: Guest 1 Live Photo | Guest 2 Live Photo | ID Front | ID Back
  const accompanyingGuests = images.accompanyingGuests || [];
  const firstAccLivePhoto = accompanyingGuests.length > 0 ? accompanyingGuests[0]?.images?.livePhoto : null;
  const firstAccName = accompanyingGuests.length > 0 ? safeText(accompanyingGuests[0]?.name, 'Guest 2') : null;

  drawImageBox(doc, area.left, startY, colW, boxHeight, 'GUEST 1: LIVE PHOTO', images.livePhoto, primaryTime ? `${primaryName.split(' ')[0]} (${primaryTime})` : null);
  drawImageBox(doc, area.left + colW + gap, startY, colW, boxHeight, 'GUEST 2: LIVE PHOTO', firstAccLivePhoto, firstAccName ? `[Webcam Captured]` : null);
  drawImageBox(doc, area.left + (colW + gap) * 2, startY, colW, boxHeight, 'GOVT ID PROOF (FRONT)', images.idImageFront);
  drawImageBox(doc, area.left + (colW + gap) * 3, startY, colW, boxHeight, 'GOVT ID PROOF (BACK)', images.idImageBack);

  doc.y = startY + boxHeight + 22;

  // Additional accompanying guest images (if more than 1)
  for (let i = 1; i < accompanyingGuests.length; i++) {
    const acc = accompanyingGuests[i];
    const hasAny = acc.images.livePhoto || acc.images.idImageFront || acc.images.idImageBack;
    if (!hasAny) continue;

    ensureSpace(doc, 130);
    const accY = doc.y;

    doc.font(CONFIG.fonts.bold).fontSize(CONFIG.fontSizes.body).fillColor(CONFIG.colors.textPrimary)
      .text(`Additional Guest: ${safeText(acc.name)}`, area.left, accY);
    const imgStartY = accY + 14;

    const accColW = (area.contentWidth - gap * 2) / 3;
    drawImageBox(doc, area.left, imgStartY, accColW, boxHeight, 'LIVE PHOTO', acc.images.livePhoto);
    drawImageBox(doc, area.left + accColW + gap, imgStartY, accColW, boxHeight, 'ID FRONT', acc.images.idImageFront);
    drawImageBox(doc, area.left + (accColW + gap) * 2, imgStartY, accColW, boxHeight, 'ID BACK', acc.images.idImageBack);

    doc.y = imgStartY + boxHeight + 16;
  }
};

// ============================================================
// SECTION 4: HOTEL VERIFICATION & AUTHORIZATION
// ============================================================

const drawAuthorizationSection = (doc, images) => {
  drawSectionTitle(doc, '4', 'HOTEL VERIFICATION & AUTHORIZATION');
  ensureSpace(doc, 140);

  const area = getPageArea(doc);
  const startY = doc.y;
  const sectionHeight = 110;

  // Outer border
  doc.rect(area.left, startY, area.contentWidth, sectionHeight).lineWidth(0.5).strokeColor(CONFIG.colors.border).stroke();

  const halfW = area.contentWidth / 2;

  // Left: Hotel Official Stamp
  doc.rect(area.left, startY, halfW, sectionHeight).lineWidth(0.5).strokeColor(CONFIG.colors.border).stroke();
  doc.font(CONFIG.fonts.bold).fontSize(CONFIG.fontSizes.label).fillColor(CONFIG.colors.textMuted)
    .text('HOTEL OFFICIAL STAMP', area.left + 10, startY + 8, { width: halfW - 20, lineBreak: false });

  if (images.hotelStamp) {
    try {
      doc.image(images.hotelStamp, area.left + 15, startY + 22, { fit: [halfW - 30, sectionHeight - 35], align: 'center', valign: 'center' });
    } catch (e) {
      drawImagePlaceholder(doc, area.left + 10, startY + 22, halfW - 20, sectionHeight - 35, '[Stamp Not Available]');
    }
  } else {
    drawImagePlaceholder(doc, area.left + 10, startY + 22, halfW - 20, sectionHeight - 35, '[Stamp Not Available]');
  }

  // Right: Owner Signature
  if (images.ownerSignature) {
    try {
      doc.image(images.ownerSignature, area.left + halfW + 15, startY + 15, { fit: [halfW - 30, sectionHeight - 40], align: 'center', valign: 'center' });
    } catch (e) {
      // Ignore
    }
  }

  // Label below signature
  doc.moveTo(area.left + halfW + 20, startY + sectionHeight - 20)
    .lineTo(area.right - 20, startY + sectionHeight - 20)
    .strokeColor(CONFIG.colors.border).lineWidth(0.3).stroke();

  doc.font(CONFIG.fonts.normal).fontSize(CONFIG.fontSizes.small).fillColor(CONFIG.colors.textSecondary)
    .text('Hotel Owner / Authorized Signatory', area.left + halfW + 10, startY + sectionHeight - 16, {
      width: halfW - 20, align: 'right',
    });

  doc.y = startY + sectionHeight + 10;
};

// ============================================================
// GUEST DECLARATION & HOTEL REGULATIONS
// ============================================================

const drawDeclaration = (doc) => {
  ensureSpace(doc, 80);
  const area = getPageArea(doc);
  const startY = doc.y;

  // Title
  doc.font(CONFIG.fonts.bold).fontSize(CONFIG.fontSizes.body).fillColor(CONFIG.colors.textPrimary)
    .text('GUEST DECLARATION & HOTEL REGULATIONS', area.left, startY);

  const rulesY = startY + 14;
  const rules = [
    '1. I/We declare that all furnished identity details are authentic and certified under Section 193 of the Indian Penal Code.',
    '2. Standard Check-In: 12:00 PM | Standard Check-Out: 11:00 AM. Extra tariff applies on unapproved delay.',
    '3. Weapons, illicit contraband, or consumption of prohibited intoxicants is strictly banned inside premises.',
    '4. Hotel authority shall not be held liable for unsecured cash or precious items kept outside personal safe lockers.',
  ];

  // Rules background
  const ruleHeight = rules.length * 11 + 10;
  doc.roundedRect(area.left, rulesY, area.contentWidth, ruleHeight, 3)
    .fillAndStroke(CONFIG.colors.declarationBg, CONFIG.colors.borderLight);

  let ruleY = rulesY + 6;
  rules.forEach((rule) => {
    doc.font(CONFIG.fonts.normal).fontSize(6.5).fillColor(CONFIG.colors.textSecondary)
      .text(rule, area.left + 8, ruleY, { width: area.contentWidth - 16 });
    ruleY += 11;
  });

  doc.y = rulesY + ruleHeight + 8;
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
    const lineY = doc.page.height - CONFIG.margin - 18;

    doc.moveTo(area.left, lineY).lineTo(area.right, lineY)
      .strokeColor(CONFIG.colors.divider).lineWidth(0.5).stroke();

    doc.font(CONFIG.fonts.bold).fontSize(CONFIG.fontSizes.footer).fillColor(CONFIG.colors.textMuted)
      .text(hotelName, area.left, lineY + 5, { width: 180, lineBreak: false });

    doc.font(CONFIG.fonts.normal).fontSize(CONFIG.fontSizes.footer).fillColor(CONFIG.colors.textMuted)
      .text(`Ref: ${bookingRef}  •  Powered by Apna Register`, area.left, lineY + 5, { width: area.contentWidth, align: 'center', lineBreak: false });

    doc.font(CONFIG.fonts.normal).fontSize(CONFIG.fontSizes.footer).fillColor(CONFIG.colors.textMuted)
      .text(`Page ${i + 1} of ${pageRange.count}`, area.left, lineY + 5, { width: area.contentWidth, align: 'right', lineBreak: false });
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
  drawHeader(doc, guestData, bookingRef);

  // Status Bar
  drawStatusBar(doc, guestData, bookingRef);

  // Section 1: Stay Allocation & Booking Details
  drawStaySection(doc, guestData);

  // Section 2: Guest Details
  drawGuestDetailsSection(doc, guestData);

  // Section 3: Digital KYC Verification
  drawKycSection(doc, images, guestData);

  // Section 4: Hotel Verification & Authorization
  drawAuthorizationSection(doc, images);

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
  drawHeader(doc, guestData, bookingRef);

  drawSectionTitle(doc, '1', 'GUEST INFORMATION');
  const area = getPageArea(doc);

  const fields = [
    { label: 'Guest Name', value: guestData?.primaryGuest?.name },
    { label: 'Customer ID', value: guestData?.customerId },
    { label: 'Hotel', value: guestData?.hotel?.hotelName || guestData?.hotel?.username },
    { label: 'Checkout Time', value: formatDateTime(guestData?.stayDetails?.checkOut || new Date()) },
  ];

  fields.forEach((f) => {
    doc.font(CONFIG.fonts.bold).fontSize(CONFIG.fontSizes.label).fillColor(CONFIG.colors.textMuted)
      .text(`${f.label}:`, area.left, doc.y, { continued: true, width: 100 });
    doc.font(CONFIG.fonts.normal).fontSize(CONFIG.fontSizes.body).fillColor(CONFIG.colors.textPrimary)
      .text(`  ${safeText(f.value)}`);
    doc.moveDown(0.3);
  });

  doc.moveDown(0.5);
  doc.font(CONFIG.fonts.italic).fontSize(CONFIG.fontSizes.small).fillColor(CONFIG.colors.textMuted)
    .text(`Detailed rendering was unavailable. Reference ${bookingRef}. Reason: ${safeText(sourceError?.message, 'Unknown')}`, { width: area.contentWidth });

  addPageFooters(doc, guestData, bookingRef);
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
