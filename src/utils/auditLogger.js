const crypto = require('crypto');
const AccessLog = require('../models/access-log.model');

async function createAuditLog({ user, userModel, action, reason, searchQuery }) {
  // Get the hash of the last entry
  const lastEntry = await AccessLog.findOne({})
    .sort({ timestamp: -1 })
    .select('entryHash')
    .lean();
  
  const previousHash = lastEntry?.entryHash || 'GENESIS_BLOCK_APNA_MANAGER';
  
  const timestamp = new Date();
  
  // Compute hash of this entry
  const hashInput = [
    timestamp.toISOString(),
    user?.toString() || 'SYSTEM',
    userModel || 'SYSTEM',
    action,
    reason || '',
    previousHash
  ].join('|');
  
  const entryHash = crypto
    .createHash('sha256')
    .update(hashInput)
    .digest('hex');
  
  const logEntry = await AccessLog.create({
    user: user || null,
    userModel: userModel || 'RegionalAdmin',
    action,
    reason,
    searchQuery,
    timestamp,
    entryHash,
    previousHash
  });
  
  return logEntry;
}

async function verifyAuditChain(fromDate) {
  const query = fromDate ? { timestamp: { $gte: fromDate } } : {};
  const entries = await AccessLog.find(query)
    .sort({ timestamp: 1 })
    .lean();
  
  if (entries.length === 0) return { valid: true, checkedCount: 0 };
  
  let previousHash = entries[0].previousHash;
  let broken = false;
  let brokenAt = null;
  
  for (const entry of entries) {
    const hashInput = [
      new Date(entry.timestamp).toISOString(),
      entry.user?.toString() || 'SYSTEM',
      entry.userModel || 'SYSTEM',
      entry.action,
      entry.reason || '',
      previousHash
    ].join('|');
    
    const expectedHash = crypto
      .createHash('sha256')
      .update(hashInput)
      .digest('hex');
    
    if (expectedHash !== entry.entryHash) {
      broken = true;
      brokenAt = entry._id;
      break;
    }
    
    previousHash = entry.entryHash;
  }
  
  return {
    valid: !broken,
    checkedCount: entries.length,
    brokenAt: brokenAt || null,
    verifiedAt: new Date()
  };
}

module.exports = { createAuditLog, verifyAuditChain };
