const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// You can set SERVICE_ACCOUNT_PATH in env to override default path
const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.join(__dirname, './newproject-66379-firebase-adminsdk-hti2s-89347cc2ef.json');

if (!admin.apps.length) {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.warn(`[firebaseAdmin] Service account file not found at ${SERVICE_ACCOUNT_PATH}. Push will fail until provided.`);
  } else {
    const serviceAccount = require(SERVICE_ACCOUNT_PATH);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
}

module.exports = admin;
