// utils/pdfGenerator.js
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const config = {
    size: 'A4',
    margin: 40,
    fonts: {
        bold: 'Helvetica-Bold',
        normal: 'Helvetica',
        italic: 'Helvetica-Oblique',
    },
    fontSizes: {
        header: 20,
        title: 13,
        body: 10,
        footer: 9,
    },
    colors: {
        primary: '#1976D2',
        textPrimary: '#111111',
        textSecondary: '#555555',
        divider: '#DDDDDD',
        headerText: '#FFFFFF',
        sectionBg: '#F7F9FC',
    },
    layout: {
        pageWidth: 595.28,
        pageHeight: 841.89,
        contentWidth: 595.28 - 80,
    }
};

// ✅ Draw header (only first page)
const drawHeader = (doc, guest) => {
    const logoPath = path.join(__dirname, '../src/assets/logo.png');

    if (fs.existsSync(logoPath)) {
        doc.image(logoPath, config.margin, 25, { width: 60 });
    }

    doc.font(config.fonts.bold)
        .fontSize(config.fontSizes.header)
        .fillColor(config.colors.primary)
        .text('Guest Stay Record', config.margin + 70, 35);

    doc.font(config.fonts.normal)
        .fontSize(config.fontSizes.body)
        .fillColor(config.colors.textSecondary)
        .text(`${guest.hotel?.details?.hotelName || 'Hotel Name'}`, config.margin + 70, 60)
        .text(`${guest.hotel?.details?.city || ''}`, config.margin + 70, 75);

    doc.moveDown(3);
    doc.moveTo(config.margin, 100)
        .lineTo(config.layout.pageWidth - config.margin, 100)
        .strokeColor(config.colors.divider)
        .lineWidth(1)
        .stroke();
    doc.moveDown(2);
};

// ✅ Draw footer (only on last page)
const drawFooter = (doc) => {
    const footerY = config.layout.pageHeight - 70;
    doc.moveTo(config.margin, footerY)
        .lineTo(config.layout.pageWidth - config.margin, footerY)
        .strokeColor(config.colors.divider)
        .lineWidth(1)
        .stroke();

    const footerText = '😊 Thank you for choosing us! We hope to see you again soon.';
    doc.font(config.fonts.italic)
        .fontSize(config.fontSizes.footer)
        .fillColor(config.colors.primary)
        .text(footerText, config.margin, footerY + 20, {
            align: 'center',
            width: config.layout.contentWidth,
        });
};

// ✅ Section title
const drawSectionTitle = (doc, title) => {
    doc.moveDown(1.2);
    doc.rect(config.margin - 5, doc.y - 2, config.layout.contentWidth + 10, 22)
        .fillOpacity(0.2)
        .fill(config.colors.primary)
        .fillOpacity(1);

    doc.fillColor(config.colors.primary)
        .font(config.fonts.bold)
        .fontSize(config.fontSizes.title)
        .text(title.toUpperCase(), config.margin, doc.y - 18);
    doc.moveDown(1);
};

// ✅ Info Row
const drawInfoRow = (doc, label, value) => {
    doc.font(config.fonts.bold)
        .fillColor(config.colors.textPrimary)
        .text(`${label}: `, { continued: true })
        .font(config.fonts.normal)
        .fillColor(config.colors.textSecondary)
        .text(value || 'N/A');
};

// ✅ Stay & Hotel Info
const renderStayAndHotelDetails = (doc, guest) => {
    drawSectionTitle(doc, 'Stay & Hotel Information');

    const columnGap = 30;
    const columnWidth = (config.layout.contentWidth - columnGap) / 2;
    const startY = doc.y;
    const leftX = doc.x;
    const rightX = leftX + columnWidth + columnGap;

    // Left Column
    drawInfoRow(doc, 'Hotel Name', guest.hotel?.details?.hotelName || guest.hotel?.username);
    drawInfoRow(doc, 'Location', guest.hotel?.details?.city);
    drawInfoRow(doc, 'Room Number', guest.stayDetails?.roomNumber);
    const leftHeight = doc.y;

    // Right Column
    doc.y = startY;
    doc.x = rightX;
    const checkInDate = new Date(guest.stayDetails.checkIn).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const checkOutDate = new Date(guest.stayDetails.expectedCheckout).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    drawInfoRow(doc, 'Check-In', checkInDate);
    drawInfoRow(doc, 'Expected Checkout', checkOutDate);
    drawInfoRow(doc, 'Purpose of Visit', guest.stayDetails?.purposeOfVisit);

    doc.x = config.margin;
    doc.y = Math.max(doc.y, leftHeight);
};

// ✅ Primary Guest
const renderPrimaryGuestDetails = (doc, guest) => {
    drawSectionTitle(doc, 'Primary Guest Details');

    const { primaryGuest } = guest;
    const imgX = config.layout.pageWidth - 150;
    const imgY = doc.y;

    if (primaryGuest?.livePhotoURL) {
        try {
            doc.image(primaryGuest.livePhotoURL, imgX, imgY, { width: 90, height: 90, fit: [90, 90] })
                .rect(imgX, imgY, 90, 90)
                .strokeColor(config.colors.divider)
                .lineWidth(0.5)
                .stroke();
        } catch {
            // Ignore broken image URLs
        }
    }

    drawInfoRow(doc, 'Customer ID', guest.customerId);
    drawInfoRow(doc, 'Name', primaryGuest?.name);
    drawInfoRow(doc, 'Gender', primaryGuest?.gender);
    drawInfoRow(doc, 'Date of Birth', new Date(primaryGuest?.dob).toLocaleDateString());
    drawInfoRow(doc, 'Phone', primaryGuest?.phone);
    drawInfoRow(doc, 'Email', primaryGuest?.email);

    const fullAddress = [
        primaryGuest?.address?.street,
        primaryGuest?.address?.city,
        primaryGuest?.address?.state,
        primaryGuest?.address?.zipCode
    ].filter(Boolean).join(', ');
    drawInfoRow(doc, 'Address', fullAddress);

    doc.moveDown(2);
};

// ✅ Accompanying Guests
const renderAccompanyingGuests = (doc, guest) => {
    const adults = guest.accompanyingGuests?.adults || [];
    const children = guest.accompanyingGuests?.children || [];

    if (adults.length === 0 && children.length === 0) return;

    drawSectionTitle(doc, 'Accompanying Guests');

    const drawTable = (label, list) => {
        doc.font(config.fonts.bold)
            .fillColor(config.colors.primary)
            .text(`${label}:`);

        doc.moveDown(0.5);
        list.forEach((g, i) => {
            doc.font(config.fonts.normal)
                .fillColor(config.colors.textPrimary)
                .text(`${i + 1}. ${g.name} (${g.gender}, DOB: ${new Date(g.dob).toLocaleDateString()})`);
            doc.moveDown(0.3);
        });
        doc.moveDown(0.5);
    };

    if (adults.length > 0) drawTable('Adults', adults);
    if (children.length > 0) drawTable('Children', children);
};

// ✅ Main Generator
const generateGuestPDF = (guest) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: config.size,
                margin: config.margin,
                layout: 'portrait',
                bufferPages: true,
            });

            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', (err) => {
                logger.error(`PDF generation error: ${err.message}`);
                reject(err);
            });

            // Draw Content
            drawHeader(doc, guest);
            renderStayAndHotelDetails(doc, guest);
            renderPrimaryGuestDetails(doc, guest);
            renderAccompanyingGuests(doc, guest);
            drawFooter(doc);

            doc.end();
        } catch (error) {
            logger.error(`Error during PDF setup: ${error.message}`);
            reject(error);
        }
    });
};

module.exports = generateGuestPDF;
