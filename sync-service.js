const admin = require('firebase-admin');
const axios = require('axios');
require('dotenv').config();

// ============ CONFIGURATION ============
// TODO: Replace these with your actual values or use .env file

const CONFIG = {
    // Laravel API endpoint
    laravelApiUrl: process.env.LARAVEL_API_URL ?
        (process.env.LARAVEL_API_URL.endsWith('/api') ? process.env.LARAVEL_API_URL : process.env.LARAVEL_API_URL + '/api')
        : 'https://jwt-prod.up.railway.app/api',

    // Firebase Database URL (from Firebase Console)
    firebaseDatabaseUrl: process.env.FIREBASE_DATABASE_URL || 'https://wattch-48f16-default-rtdb.asia-southeast1.firebasedatabase.app',

    // User database name in MySQL
    userDatabase: process.env.DEFAULT_USER_DB || 'admin',

    // How often to sync (milliseconds)
    syncInterval: parseInt(process.env.SYNC_INTERVAL) || 10000,

    // Enable debug logging
    debug: process.env.DEBUG === 'true' || true
};

// Firebase service account credentials path
// Download this JSON file from Firebase Console > Project Settings > Service Accounts
const SERVICE_ACCOUNT_PATH = './firebase-service-account.json';

// ESP to load type mapping
// ESP to load type mapping helper
function getLoadType(espId) {
    if (espId.startsWith('ESP1')) return 'light';
    if (espId.startsWith('ESP2')) return 'medium';
    if (espId.startsWith('ESP3')) return 'heavy';
    if (espId.startsWith('ESP4')) return 'universal';
    return null;
}

// ============ INITIALIZATION ============

let serviceAccount;
try {
    serviceAccount = require(SERVICE_ACCOUNT_PATH);
} catch (error) {
    console.error('ERROR: firebase-service-account.json not found!');
    console.error('Please download it from Firebase Console and place it in this directory.');
    console.error('Path should be: jwt/firebase-sync/firebase-service-account.json');
    process.exit(1);
}

// Initialize Firebase Admin
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: CONFIG.firebaseDatabaseUrl
});

const db = admin.database();
const log = (...args) => CONFIG.debug && console.log(new Date().toISOString(), ...args);

// ============ SYNC STATE ============

const syncState = {
    lastSyncTime: {},
    lastPowerValue: {},
    syncCount: 0,
    errorCount: 0
};

// Initialize sync times for each ESP
// Initialize sync times for each ESP
// We will initialize these dynamically as we discover devices
// Object.keys(ESP_TO_LOAD_TYPE).forEach(espId => {
//     syncState.lastSyncTime[espId] = Date.now();
//     syncState.lastPowerValue[espId] = 0;
// });

// ============ SYNC LOGIC ============

async function syncToDatabase(espId, espData) {
    const now = Date.now();
    // Initialize state if new device
    if (!syncState.lastSyncTime[espId]) {
        syncState.lastSyncTime[espId] = now;
        syncState.lastPowerValue[espId] = 0;
        // Don't return, let it sync the first value if needed, or just wait for next change
        // But for first run, we might want to sync immediately if power > 0?
        // Let's just initialize and wait for next update or interval
    }

    const lastSync = syncState.lastSyncTime[espId];
    const durationSeconds = (now - lastSync) / 1000;

    // Update sync time
    syncState.lastSyncTime[espId] = now;

    const currentPower = espData.power || 0;
    const lastPower = syncState.lastPowerValue[espId];

    // Only sync if power value changed or it's been more than sync interval
    if (currentPower === lastPower && durationSeconds < CONFIG.syncInterval / 1000) {
        return;
    }

    syncState.lastPowerValue[espId] = currentPower;

    try {
        const response = await axios.post(
            `${CONFIG.laravelApiUrl}/consumption/sync-firebase`,
            {
                name: CONFIG.userDatabase,
                load_type: getLoadType(espId),
                socket_id: espId,
                power: currentPower,
                duration_seconds: durationSeconds
            },
            {
                timeout: 5000,
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        syncState.syncCount++;
        log(`✓ Synced ${espId}: ${currentPower}W (${durationSeconds.toFixed(1)}s) -> ${response.data.buckets?.hour}`);

    } catch (error) {
        syncState.errorCount++;
        console.error(`✗ Sync failed for ${espId}:`, error.message);
        if (error.response) {
            console.error('Response:', error.response.data);
        }
    }
}

// ============ FIREBASE LISTENERS ============

console.log('='.repeat(50));
console.log('Firebase Sync Service Starting...');
console.log('='.repeat(50));
console.log('Configuration:');
console.log('  Laravel API:', CONFIG.laravelApiUrl);
console.log('  Firebase DB:', CONFIG.firebaseDatabaseUrl);
console.log('  User DB:', CONFIG.userDatabase);
console.log('  Sync Interval:', CONFIG.syncInterval, 'ms');
console.log('='.repeat(50));

// Listen to Firebase root
const firebaseRef = db.ref('WATTch');

firebaseRef.on('value', (snapshot) => {
    const data = snapshot.val();

    if (!data) {
        console.error('No data found in Firebase at path "WATTch"');
        return;
    }

    // Sync each ESP device
    Object.keys(data).forEach(espId => {
        // Only process keys that look like ESP IDs (ESP1, ESP1_1, etc.)
        if (espId.startsWith('ESP')) {
            syncToDatabase(espId, data[espId]);
        }
    });
}, (error) => {
    console.error('Firebase read error:', error);
});

// Status report every minute
setInterval(() => {
    console.log('\n' + '='.repeat(50));
    console.log('Status Report:');
    console.log(`  Total syncs: ${syncState.syncCount}`);
    console.log(`  Errors: ${syncState.errorCount}`);
    console.log(`  Success rate: ${syncState.syncCount > 0 ? ((syncState.syncCount / (syncState.syncCount + syncState.errorCount)) * 100).toFixed(1) : 0}%`);

    Object.keys(syncState.lastSyncTime).forEach(espId => {
        const lastSync = ((Date.now() - syncState.lastSyncTime[espId]) / 1000).toFixed(0);
        console.log(`  ${espId}: ${syncState.lastPowerValue[espId]}W (last sync ${lastSync}s ago)`);
    });
    console.log('='.repeat(50) + '\n');
}, 60000);

// Check for resets every minute
setInterval(async () => {
    try {
        const response = await axios.post(
            `${CONFIG.laravelApiUrl}/consumption/check-reset`,
            { name: CONFIG.userDatabase },
            { timeout: 5000 }
        );
        if (response.data.resets_performed && response.data.resets_performed.length > 0) {
            log('✓ Performed resets:', response.data.resets_performed.join(', '));
        }
    } catch (error) {
        console.error('✗ Reset check failed:', error.message);
    }
}, 60000);

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down Firebase sync service...');
    console.log(`Final stats: ${syncState.syncCount} syncs, ${syncState.errorCount} errors`);
    process.exit(0);
});

console.log('\n✓ Firebase sync service is running!');
console.log('Press Ctrl+C to stop.\n');
