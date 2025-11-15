// src/utils/pdfGenerator.js
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// --- Configuration ---
const CONFIG = {
    size: 'A4',
    margin: 50,
    fonts: {
        bold: 'Helvetica-Bold',
        normal: 'Helvetica',
        italic: 'Helvetica-Oblique',
    },
    fontSizes: {
        header: 18,
        tagline: 10,
        hotelName: 14,
        sectionTitle: 12,
        body: 10,
        footer: 9,
    },
    colors: {
        primary: '#0d47a1', // Dark Blue
        textPrimary: '#222222',
        textSecondary: '#555555',
        divider: '#CCCCCC',
    },
    layout: {
        pageWidth: 595.28,
        contentWidth: 595.28 - 100, // Page width - (margin * 2)
    }
};


const drawHeader = (doc, guest) => {
    const logoPath = path.join(__dirname, '../assets/logo.png');
    
    // 1. ApnaManager Logo
    if (fs.existsSync(logoPath)) {
        doc.image(logoPath, (CONFIG.layout.pageWidth - 100) / 2, CONFIG.margin - 10, {
            width: 100,
            align: 'center'
        });
    }
    
    // 2. "Centralized Data Management System"
    doc.moveDown(1);
    doc.font(CONFIG.fonts.italic)
        .fontSize(CONFIG.fontSizes.tagline)
        .fillColor(CONFIG.colors.textSecondary)
        .text('Centralized Data Management System', {
            align: 'center',
            width: CONFIG.layout.contentWidth,
        });

    // 3. Hotel Name
    const hotelName = guest.hotel?.hotelName || 'Guest Receipt';
    doc.moveDown(1.5);
    doc.font(CONFIG.fonts.bold)
        .fontSize(CONFIG.fontSizes.hotelName)
        .fillColor(CONFIG.colors.primary)
        .text(hotelName, {
            align: 'center',
            width: CONFIG.layout.contentWidth,
        });

    // 4. Divider Line
    doc.moveDown(1);
    doc.moveTo(CONFIG.margin, doc.y)
        .lineTo(CONFIG.layout.pageWidth - CONFIG.margin, doc.y)
        .strokeColor(CONFIG.colors.divider)
        .lineWidth(0.5)
        .stroke();
    doc.moveDown(2);
};


const drawFooter = (doc, guest) => {
    const hotelName = guest.hotel?.hotelName || 'our partner hotel';
    const footerY = doc.page.height - CONFIG.margin - 40; // Position from bottom

    // 1. Divider Line
    doc.moveTo(CONFIG.margin, footerY)
        .lineTo(CONFIG.layout.pageWidth - CONFIG.margin, footerY)
        .strokeColor(CONFIG.colors.divider)
        .lineWidth(0.5)
        .stroke();

    // 2. Kind Message
    doc.moveDown(1);
    doc.font(CONFIG.fonts.italic)
        .fontSize(CONFIG.fontSizes.footer)
        .fillColor(CONFIG.colors.textSecondary)
        .text(
            `Thank you for choosing ${hotelName}. We wish you safe travels and hope to welcome you again soon.`,
            CONFIG.margin, 
            doc.y, 
            {
                align: 'center',
                width: CONFIG.layout.contentWidth,
            }
        );
    
    // 3. Powered by
    doc.moveDown(0.5);
    doc.font(CONFIG.fonts.normal)
        .fontSize(CONFIG.fontSizes.footer - 1)
        .text(
            'This is a system-generated receipt powered by ApnaManager.',
            {
                align: 'center',
                width: CONFIG.layout.contentWidth,
            }
        );
};

const drawSectionTitle = (doc, title) => {
    doc.moveDown(1.5);
    doc.font(CONFIG.fonts.bold)
        .fontSize(CONFIG.fontSizes.sectionTitle)
        .fillColor(CONFIG.colors.primary)
        .text(title);
    
    doc.moveTo(CONFIG.margin, doc.y)
        .lineTo(CONFIG.margin + 200, doc.y)
        .strokeColor(CONFIG.colors.primary)
        .lineWidth(0.5)
        .stroke();
    doc.moveDown(0.75);
};

const drawInfoRow = (doc, label, value) => {
    doc.font(CONFIG.fonts.bold)
        .fontSize(CONFIG.fontSizes.body)
        .fillColor(CONFIG.colors.textPrimary)
        .text(`${label}: `, { continued: true })
        .font(CONFIG.fonts.normal)
        .fillColor(CONFIG.colors.textSecondary)
        .text(value || 'N/A');
};

const renderPrimaryGuestDetails = (doc, guest) => {
    drawSectionTitle(doc, 'Primary Guest Details');
    
    const { primaryGuest } = guest;
    const fullAddress = [
        primaryGuest.address?.street,
        primaryGuest.address?.city,
        primaryGuest.address?.state,
        primaryGuest.address?.zipCode
    ].filter(Boolean).join(', ');

    // Use columns for better layout
    const columnGap = 40;
    const columnWidth = (CONFIG.layout.contentWidth - columnGap) / 2;
    const startY = doc.y;
    const leftX = doc.x;
    const rightX = leftX + columnWidth + columnGap;

    // Left Column
    drawInfoRow(doc, 'Name', primaryGuest.name);
    drawInfoRow(doc, 'Phone', primaryGuest.phone);
    drawInfoRow(doc, 'Email', primaryGuest.email);
    drawInfoRow(doc, 'Gender', primaryGuest.gender);
    drawInfoRow(doc, 'Date of Birth', new Date(primaryGuest.dob).toLocaleDateString('en-IN'));
    const leftHeight = doc.y;

    // Right Column
    doc.y = startY;
    doc.x = rightX;
    drawInfoRow(doc, 'Customer ID', guest.customerId);
    drawInfoRow(doc, 'ID Type', guest.idType);
    drawInfoRow(doc, 'ID Number', guest.idNumber);
    drawInfoRow(doc, 'Nationality', primaryGuest.nationality);
    drawInfoRow(doc, 'Address', fullAddress);

    // Reset cursor
    doc.x = CONFIG.margin;
    doc.y = Math.max(doc.y, leftHeight); // Move to the bottom of the tallest column
};

const renderStayDetails = (doc, guest) => {
    drawSectionTitle(doc, 'Stay Details');
    
    const { stayDetails } = guest;
    
    const checkIn = new Date(stayDetails.checkIn).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const checkOut = new Date(stayDetails.expectedCheckout).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

    drawInfoRow(doc, 'Room Number', stayDetails.roomNumber);
    drawInfoRow(doc, 'Check-In', checkIn);
    drawInfoRow(doc, 'Expected Checkout', checkOut);
    drawInfoRow(doc, 'Purpose of Visit', stayDetails.purposeOfVisit);
};

const renderAccompanyingGuests = (doc, guest) => {
    const { adults = [], children = [] } = guest.accompanyingGuests || {};

    if (adults.length === 0 && children.length === 0) {
        return; // Don't draw this section if there are no other guests
    }

    drawSectionTitle(doc, 'Accompanying Guests');

    // Adults Table
    if (adults.length > 0) {
        doc.font(CONFIG.fonts.bold).text('Accompanying Adults', { underline: true });
        doc.moveDown(0.5);
        adults.forEach((adult, i) => {
            const text = `${i + 1}. ${adult.name} (${adult.gender}, DOB: ${new Date(adult.dob).toLocaleDateString('en-IN')})`;
            doc.font(CONFIG.fonts.normal).text(text);
        });
        doc.moveDown(1);
    }

    // Children Table
    if (children.length > 0) {
        doc.font(CONFIG.fonts.bold).text('Accompanying Children', { underline: true });
        doc.moveDown(0.5);
        children.forEach((child, i) => {
            const text = `${i + 1}. ${child.name} (${child.gender}, DOB: ${new Date(child.dob).toLocaleDateString('en-IN')})`;
            doc.font(CONFIG.fonts.normal).text(text);
        });
    }
};

/**
 * Generates the full PDF document as a Buffer.
 * @param {object} guestData - The full guest Mongoose document, populated with hotel info.
 * @returns {Promise<Buffer>} A Promise that resolves with the PDF Buffer.
 */
const generateGuestPDF = (guestData) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: CONFIG.size,
                margin: CONFIG.margin,
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

            drawHeader(doc, guestData);
            renderStayDetails(doc, guestData);
            renderPrimaryGuestDetails(doc, guestData);
            renderAccompanyingGuests(doc, guestData);
            drawFooter(doc, guestData);
            
            // Finalize the PDF
            doc.end();
        } catch (error) {
            logger.error(`Error during PDF setup: ${error.message}`);
            reject(error);
        }
    });
};

module.exports = generateGuestPDF;