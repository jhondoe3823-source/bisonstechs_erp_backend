/**
 * Notification inbox (Postgres) + OneSignal device push.
 * Delivery path is OneSignal (Flutter / desktop / web push) — not SSE.
 */
const prisma = require('../prisma/client');
const { sendPushToUser, buildExternalId } = require('./onesignal');

async function sendToUser({
  mongoUserId,
  subscriptionId,
  title,
  message,
  data = {},
  type = 'info',
  category = 'System',
  collapseId,
}) {
  const userId = String(mongoUserId || '').trim();
  if (!userId) throw new Error('userId is required');

  const notification = await prisma.notification.create({
    data: {
      userId,
      title: title || 'Notification',
      message: message || '',
      type,
      category,
      data: data || {},
    },
  });

  let push = null;
  let pushError = null;
  try {
    push = await sendPushToUser({
      mongoUserId: userId,
      subscriptionId,
      title: title || 'Notification',
      message: message || '',
      data: {
        ...(data || {}),
        notificationId: notification.id,
        category,
        type,
      },
      collapseId,
    });
  } catch (err) {
    pushError = err.message || String(err);
    console.error('[OneSignal] push failed:', err.response?.data || err.message);
  }

  return {
    id: notification.id,
    stored: true,
    push,
    deliveredLive: Boolean(push?.id),
    pushError,
    externalId: buildExternalId(userId),
  };
}

async function sendToUsers(userIds, payload) {
  const ids = [...new Set((userIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const results = [];
  const BATCH = 40;
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const chunkResults = await Promise.all(
      chunk.map((mongoUserId) =>
        sendToUser({ mongoUserId, ...payload }).catch((err) => ({
          userId: mongoUserId,
          error: err.message,
        }))
      )
    );
    results.push(...chunkResults);
  }
  return results;
}

module.exports = {
  sendToUser,
  sendToUsers,
  buildExternalId,
};
