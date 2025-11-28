# Firebase Sync Service

Background service that continuously syncs Firebase data to MySQL database.

## Setup

### 1. Install Dependencies

```bash
cd jwt/firebase-sync
npm install
```

### 2. Get Firebase Service Account

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Click gear icon → Project Settings
4. Go to "Service Accounts" tab
5. Click "Generate new private key"
6. Save the downloaded JSON file as `firebase-service-account.json` in this directory

### 3. Configure Environment

Copy `env.example` to `.env` and update:

```bash
cp env.example .env
```

Edit `.env`:
- Set `FIREBASE_DATABASE_URL` to your Firebase Realtime Database URL
- Set `DEFAULT_USER_DB` to your MySQL user database name (e.g., "admin")
- Adjust `SYNC_INTERVAL` if needed (default: 10000ms = 10 seconds)

### 4. Run the Service

**Development:**
```bash
npm start
```

**With auto-restart (recommended for development):**
```bash
npm run dev
```

**Production (Windows):**

Install PM2 globally:
```bash
npm install -g pm2
```

Start service:
```bash
pm2 start sync-service.js --name firebase-sync
pm2 save
pm2 startup
```

Manage service:
```bash
pm2 status          # Check status
pm2 logs firebase-sync  # View logs
pm2 restart firebase-sync
pm2 stop firebase-sync
```

## How It Works

1. Service connects to Firebase Realtime Database
2. Listens for changes on `WATTch/{ESP_ID}/power` paths
3. When power value changes, calculates duration since last sync
4. Sends data to Laravel API `/api/consumption/sync-firebase`
5. Laravel stores data in time-bucketed columns (h4, h8, mon, tue, etc.)

## Monitoring

- Service logs every sync operation
- Status report printed every minute
- Shows sync count, error count, and last values for each ESP

## Troubleshooting

**"firebase-service-account.json not found"**
- Download service account JSON from Firebase Console
- Place it in `jwt/firebase-sync/` directory

**"Connection refused to Laravel API"**
- Make sure Laravel server is running: `php artisan serve`
- Check LARAVEL_API_URL in .env

**"No data found in Firebase"**
- Verify Firebase Database URL is correct
- Check that data exists at path `WATTch/ESP1`, etc.
- Verify service account has read permissions

**High error count**
- Check Laravel logs for API errors
- Verify MySQL database exists and has time bucket columns
- Run the database migration: `add_time_buckets_manual.sql`
