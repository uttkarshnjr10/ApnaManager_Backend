/**
 * @module models
 * @description Barrel export for all Mongoose models.
 * Provides a single import point for all data models in the application.
 */
module.exports = {
  Guest: require('./guest.model'),
  Hotel: require('./hotel.model'),
  RegionalAdmin: require('./regional-admin.model'),
  AccessLog: require('./access-log.model'),
  Alert: require('./alert.model'),
  HotelInquiry: require('./hotel-inquiry.model'),
  Notification: require('./notification.model'),
  Watchlist: require('./watchlist.model'),
};
