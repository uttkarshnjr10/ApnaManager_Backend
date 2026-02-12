const logger = require('./logger');

/**
 * Sanitizes a string for CSV by escaping double quotes and wrapping in double quotes.
 * @param {string} value - The value to sanitize.
 * @returns {string} - The sanitized CSV-safe string.
 */
const sanitizeForCSV = (value) => {
  if (value === null || value === undefined) {
    return '""';
  }
  const str = String(value);
  // Escape any double quotes by doubling them up
  const escapedStr = str.replace(/"/g, '""');
  return `"${escapedStr}"`;
};

/**
 * Generates a CSV report string from an array of guest objects.
 * @param {Array<Object>} guests - An array of Mongoose Guest documents.
 * @returns {string} - The CSV report as a single string.
 */
const generateGuestReportCSV = (guests) => {
  if (!guests || guests.length === 0) {
    return ''; // Return empty string if no guests
  }

  // Define CSV Headers
  const headers = [
    'Customer ID',
    'Name',
    'Phone',
    'Email',
    'ID Type',
    'ID Number',
    'Address',
    'Room Number',
    'Check-In',
    'Expected Checkout',
    'Status',
    'Accompanying Adults',
    'Accompanying Children',
  ];

  // Start CSV string with the header row
  let csvContent = headers.join(',') + '\n';
  logger.info(`Generating report for ${guests.length} guest records...`);

  try {
    // Add data rows
    for (const guest of guests) {
      const primary = guest.primaryGuest;
      const address = primary.address || {};
      const stay = guest.stayDetails || {};

      const fullAddress = [address.street, address.city, address.state, address.zipCode]
        .filter(Boolean)
        .join(', '); // Join address parts with a comma

      const checkIn = new Date(stay.checkIn).toLocaleString('en-IN', {
        dateStyle: 'short',
        timeStyle: 'short',
      });
      const expectedCheckout = new Date(stay.expectedCheckout).toLocaleString('en-IN', {
        dateStyle: 'short',
      });

      const row = [
        guest.customerId,
        primary.name,
        primary.phone,
        primary.email,
        guest.idType,
        guest.idNumber,
        fullAddress,
        stay.roomNumber,
        checkIn,
        expectedCheckout,
        guest.status,
        guest.accompanyingGuests.adults.length,
        guest.accompanyingGuests.children.length,
      ];

      // Sanitize each value and join with commas
      csvContent += row.map(sanitizeForCSV).join(',') + '\n';
    }

    return csvContent;
  } catch (error) {
    logger.error(`Error during CSV generation: ${error.message}`);
    throw new Error('Failed to generate guest report.'); // This will be caught by asyncHandler
  }
};

module.exports = { generateGuestReportCSV };
