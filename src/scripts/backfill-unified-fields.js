/**
 * Backfill Script: Populate allIdNumbers and allNames for existing guest records.
 *
 * This script streams all Guest documents and triggers a save on each one,
 * which fires the pre-save hook to populate the unified search fields.
 *
 * Usage:
 *   NODE_ENV=production node src/scripts/backfill-unified-fields.js
 *
 * Safe to run multiple times — it's idempotent.
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const Guest = require('../models/guest.model');

const BATCH_SIZE = 100;

const run = async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('❌ MONGO_URI not set in .env');
    process.exit(1);
  }

  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('✅ Connected.');

  const totalDocs = await Guest.countDocuments();
  console.log(`📊 Total guest records to backfill: ${totalDocs}`);

  if (totalDocs === 0) {
    console.log('✅ No records to process. Done.');
    await mongoose.disconnect();
    return;
  }

  let processed = 0;
  let errors = 0;

  // Use cursor for memory-efficient streaming
  const cursor = Guest.find().cursor();

  let batch = [];

  for await (const guest of cursor) {
    batch.push(guest);

    if (batch.length >= BATCH_SIZE) {
      const results = await Promise.allSettled(batch.map((g) => g.save()));
      results.forEach((r) => {
        if (r.status === 'fulfilled') processed++;
        else {
          errors++;
          console.error(`  ⚠️ Failed for ${r.reason?.message || 'unknown'}`);
        }
      });
      console.log(`  ⏳ Progress: ${processed + errors}/${totalDocs} (${errors} errors)`);
      batch = [];
    }
  }

  // Process remaining
  if (batch.length > 0) {
    const results = await Promise.allSettled(batch.map((g) => g.save()));
    results.forEach((r) => {
      if (r.status === 'fulfilled') processed++;
      else {
        errors++;
        console.error(`  ⚠️ Failed for ${r.reason?.message || 'unknown'}`);
      }
    });
  }

  console.log(`\n✅ Backfill complete.`);
  console.log(`   Processed: ${processed}`);
  console.log(`   Errors:    ${errors}`);

  await mongoose.disconnect();
  console.log('🔌 Disconnected.');
};

run().catch((err) => {
  console.error('❌ Backfill script failed:', err.message);
  process.exit(1);
});
