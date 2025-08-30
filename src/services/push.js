const admin = require('../configs/firebaseAdmin');

// APNs (VoIP) support
let apnProvider = null;
function getApnsProvider() {
  if (apnProvider) return apnProvider;
  try {
    // Lazy load to avoid requiring if not installed yet
    const apn = require('apn');
    const {
      APNS_KEY_ID,
      APNS_TEAM_ID,
      APNS_BUNDLE_ID,
      APNS_KEY_PATH,
      APNS_PRODUCTION,
    } = process.env;

    if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_BUNDLE_ID || !APNS_KEY_PATH) {
      console.warn('[push] APNs env vars missing; VoIP pushes disabled');
      return null;
    }

    apnProvider = new apn.Provider({
      token: {
        key: APNS_KEY_PATH, // path to AuthKey_XXXXXXXXXX.p8
        keyId: APNS_KEY_ID,
        teamId: APNS_TEAM_ID,
      },
      production: String(APNS_PRODUCTION || '').toLowerCase() === 'true',
    });
    return apnProvider;
  } catch (e) {
    console.warn('[push] apn package not installed; run `yarn add apn` to enable VoIP pushes.');
    return null;
  }
}

async function sendVoipAPNs(voipToken, callData = {}) {
  const provider = getApnsProvider();
  if (!provider) throw new Error('APNs provider not configured');
  const apn = require('apn');
  const note = new apn.Notification();
  // VoIP required headers via properties
  note.topic = `${process.env.APNS_BUNDLE_ID}.voip`;
  note.pushType = 'voip';
  note.payload = {
    ...callData,
    // Optional: flag for client
    type: 'incoming_call',
  };
  // VoIP should be high priority and silent; CallKit UI is shown by AppDelegate
  note.contentAvailable = 1;
  // Send
  const res = await provider.send(note, voipToken);
  if (res.failed && res.failed.length) {
    const first = res.failed[0];
    const reason = first?.response?.reason || first?.error?.message || 'unknown';
    throw new Error(`APNs VoIP failed: ${reason}`);
  }
  return res;
}

async function sendToToken(token, { notification, data = {} }) {
  if (!admin?.apps?.length) {
    console.warn('[push] Firebase Admin is not initialized. Skipping push.');
    return;
  }

  // Ensure data payload values are strings (FCM requirement)
  const stringData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, v != null ? String(v) : ''])
  );

  const isCall = data?.type === 'incoming_call';

  const message = {
    token,
    // For calls, use data-only messages to trigger CallKeep
    notification: isCall ? undefined : notification,
    data: stringData,
    android: {
      priority: 'high',
      ttl: isCall ? 30000 : undefined, // 30-second TTL for calls
      // Add channel for calls
      ...(isCall && {
        notification: {
          channel_id: 'calls',
          priority: 'high',
          default_sound: true,
          // default_vibrate: true,
        }
      })
    },
    apns: {
      headers: {
        'apns-priority': '10',
        // Do NOT set 'voip' push-type via FCM; true VoIP will be sent via APNs directly
      },
      payload: {
        aps: {
          sound: 'default',
          'mutable-content': 1,
          // For calls, add call-specific payload
          ...(isCall && {
            'content-available': 1,
            category: 'INCOMING_CALL'
          })
        },
      },
    },
  };

  try {
    const res = await admin.messaging().send(message);
    console.log('[push] Message sent successfully:', res);
    return res;
  } catch (error) {
    if (error?.errorInfo?.code === 'messaging/registration-token-not-registered') {
      console.error('[push] Token not registered (invalid/expired):', token);
    } else {
      console.error('[push] Error sending notification:', error?.message || error);
    }
    throw error;
  }
}

async function sendMessageNotification(token, { title, body, data = {} }) {
  return sendToToken(token, {
    notification: { title, body },
    data: { type: 'message', ...data },
  });
}

// Send incoming call notification with proper VoIP support
async function sendIncomingCallNotification(token, { title, body, data = {} }) {
  console.log('[push] Sending incoming call notification:', { token, title, body, data });
  
  // For Android or fallback on iOS FCM token, send via FCM data
  return sendToToken(token, {
    // Include notification for Android heads-up display
    notification: {
      title: title || 'Incoming Call',
      body: body || 'You have an incoming call'
    },
    data: { 
      type: 'incoming_call',
      ...data
    },
  });
}

// Send VoIP push directly via APNs to iOS PushKit token
async function sendIncomingCallVoip(voipToken, callData = {}) {
  console.log('[push] Sending APNs VoIP call:', { voipToken: voipToken?.slice(0,6) + '...', callData });
  return sendVoipAPNs(voipToken, callData);
}

// Add VoIP token registration function
async function sendVoIPPush(voipToken, callData) {
  // This would be for iOS VoIP pushes using APNs directly
  // For now, we'll use FCM high-priority push
  console.log('[push] VoIP push requested:', { voipToken, callData });
  
  try {
    // Prefer APNs VoIP route
    return await sendIncomingCallVoip(voipToken, callData);
  } catch (error) {
    console.error('[push] VoIP push failed:', error);
    throw error;
  }
}

module.exports = { 
  sendToToken, 
  sendMessageNotification, 
  sendIncomingCallNotification,
  sendIncomingCallVoip,
  sendVoIPPush 
};