const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Guest = require('../models/Guest.model');

dotenv.config();

const createIndexes = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('🔌 Connected to DB...');

        console.log('🚀 Creating Indexes...');
        
        // 1. Text Index for Name (Fastest for full-text search)
        await Guest.collection.createIndex({ "primaryGuest.name": "text" });
        
        // 2. Standard Indexes for Phone and ID (Exact matches)
        await Guest.collection.createIndex({ "primaryGuest.phone": 1 });
        await Guest.collection.createIndex({ "idNumber": 1 });
        
        // 3. Compound Index for Hotel + Date (For Reports/Analytics)
        await Guest.collection.createIndex({ "hotel": 1, "registrationTimestamp": -1 });

        console.log('✅ Enterprise Indexes Created Successfully!');
        process.exit();
    } catch (error) {
        console.error('❌ Indexing Failed:', error);
        process.exit(1);
    }
};

createIndexes();