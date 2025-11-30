const admin = require('firebase-admin');
const axios = require('axios');
require('dotenv').config();

const CONFIG = {
    laravelApiUrl: process.env.LARAVEL_API_URL ?
        (process.env.LARAVEL_API_URL.endsWith('/api') ? process.env.LARAVEL_API_URL : process.env.LARAVEL_API_URL + '/api')
        : 'https://jwt-prod.up.railway.app/api',
    firebaseDatabaseUrl: process.env.FIREBASE_DATABASE_URL || 'https://wattch-48f16-default-rtdb.asia-southeast1.firebasedatabase.app',
    userDatabase: process.env.DEFAULT_USER_DB || 'admin',
    syncInterval: parseInt(process.env.SYNC_INTERVAL) || 1000,
    debug: process.env.DEBUG === 'true' || true
};

const SERVICE_ACCOUNT_PATH = './firebase-service-account.json';

function getLoadType(espId) {
    if (espId.startsWith('ESP1')) return 'light';
    if (espId.startsWith('ESP2')) return 'medium';
    if (espId.startsWith('ESP3')) return 'heavy';
    if (espId.startsWith('ESP4')) return 'universal';
    return null;
}

let serviceAccount;
try {
    serviceAccount = require(SERVICE_ACCOUNT_PATH);
} catch (error) {
    console.error('ERROR: firebase-service-account.json not found!');
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: CONFIG.firebaseDatabaseUrl
});

const db = admin.database();

const log = (...args) => {
    if (CONFIG.debug) {
        const manilaTime = new Intl.DateTimeFormat('en-PH', {
            timeZone: 'Asia/Manila',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }).format(new Date());
        console.log(`[${manilaTime}]`, ...args);
    }
};

const syncState = {
    lastSyncTime: {},
    lastPowerValue: {},
    syncCount: 0,
    errorCount: 0
};

async function syncToDatabase(espId, espData) {
    const now = Date.now();
    if (!syncState.lastSyncTime[espId]) {
        syncState.lastSyncTime[espId] = now;
        syncState.lastPowerValue[espId] = 0;
    }

    const lastSync = syncState.lastSyncTime[espId];
    const durationSeconds = (now - lastSync) / 1000;
    syncState.lastSyncTime[espId] = now;

    const currentPower = espData.power || 0;
    const lastPower = syncState.lastPowerValue[espId];

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
                headers: { 'Content-Type': 'application/json' }
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

console.log('='.repeat(50));
console.log('Firebase Sync Service Starting...');
console.log('='.repeat(50));
console.log('Configuration:');
console.log('  Laravel API:', CONFIG.laravelApiUrl);
console.log('  Firebase DB:', CONFIG.firebaseDatabaseUrl);
console.log('  User DB:', CONFIG.userDatabase);
console.log('  Sync Interval:', CONFIG.syncInterval, 'ms');
console.log('='.repeat(50));

const firebaseRef = db.ref('WATTch');

firebaseRef.on('value', (snapshot) => {
    const data = snapshot.val();
    if (!data) {
        console.error('No data found in Firebase at path "WATTch"');
        return;
    }
    Object.keys(data).forEach(espId => {
        if (espId.startsWith('ESP')) {
            syncToDatabase(espId, data[espId]);
        }
    });
}, (error) => {
    console.error('Firebase read error:', error);
});

setInterval(() => {
    console.log('\n' + '='.repeat(50));
    console.log('Status Report:');
    console.log(`  Total syncs: ${syncState.syncCount}`);
    console.log(`  Errors: ${syncState.errorCount}`);
    console.log(`  Success rate: ${syncState.syncCount > 0 ? ((syncState.syncCount / (syncState.syncCount + syncState.errorCount)) * 100).toFixed(1) : 0}%`);
    Object.keys(syncState.lastSyncTime).forEach(espId => {
        const lastSyncTime = new Date(syncState.lastSyncTime[espId]).toLocaleString('en-PH', { timeZone: 'Asia/Manila' });
        console.log(`  ${espId}: ${syncState.lastPowerValue[espId]}W (last sync at ${lastSyncTime})`);
    });
    console.log('='.repeat(50) + '\n');
}, 60000);

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

process.on('SIGINT', () => {
    console.log('\nShutting down Firebase sync service...');
    console.log(`Final stats: ${syncState.syncCount} syncs, ${syncState.errorCount} errors`);
    process.exit(0);
});

console.log('\n✓ Firebase sync service is running!');
console.log('Press Ctrl+C to stop.\n');
