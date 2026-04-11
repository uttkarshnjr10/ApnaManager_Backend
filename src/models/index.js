/**
 * @module models
 * @description Barrel export for all Mongoose models.
 * Provides a single import point for all data models in the application.
 */
module.exports = {
  Guest: require('./guest.model'),
  Hotel: require('./hotel.model'),
  Police: require('./police.model'),
  RegionalAdmin: require('./regional-admin.model'),
  PoliceStation: require('./police-station.model'),
  AccessLog: require('./access-log.model'),
  Alert: require('./alert.model'),
  CaseReport: require('./case-report.model'),
  HotelInquiry: require('./hotel-inquiry.model'),
  Notification: require('./notification.model'),
  Remark: require('./remark.model'),
  Watchlist: require('./watchlist.model'),
};
