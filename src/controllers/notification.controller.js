const { generateResponse } = require('../utils/helper');
const { User } = require('../../models');
const pushService = require('../services/push');

module.exports.registerToken = async (req, res) => {
  try {
    const { userId, fcmToken } = req.body;
    if (!userId || !fcmToken) {
      return res
        .status(400)
        .json(generateResponse('failure', '', 'userId and fcmToken are required'));
    }

    const user = await User.findOne({ where: { id: userId } });
    if (!user) {
      return res.status(404).json(generateResponse('failure', '', 'User not found'));
    }

    await User.update({ fcmToken }, { where: { id: userId } });
    return res.status(200).json(generateResponse('success', { userId, fcmToken }, 'Token registered'));
  } catch (error) {
    console.error('registerToken error', error);
    return res.status(500).json(generateResponse('error', '', error.message));
  }
};

module.exports.sendTest = async (req, res) => {
  try {
    const { userId, title = 'Test', body = 'Hello' } = req.body;
    if (!userId) {
      return res
        .status(400)
        .json(generateResponse('failure', '', 'userId is required'));
    }

    const user = await User.findOne({ where: { id: userId } });
    if (!user || !user.fcmToken) {
      return res.status(404).json(generateResponse('failure', '', 'User or token not found'));
    }

    await pushService.sendToToken(user.fcmToken, {
      notification: { title, body },
      data: { type: 'test', userId: String(userId) },
    });

    return res.status(200).json(generateResponse('success', {}, 'Notification sent'));
  } catch (error) {
    console.error('sendTest error', error);
    return res.status(500).json(generateResponse('error', '', error.message));
  }
};
