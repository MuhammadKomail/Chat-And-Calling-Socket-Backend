const { Message } = require('../../models');
const { generateResponse } = require('../utils/helper');

module.exports.getRoomMessages = async (req, res) => {
  try {
    const messages = await Message.findAll({
      where: { roomId: req.params.roomId },
      order: [['createdAt', 'ASC']]
    });
    res.json(generateResponse('success', messages, ''));
  } catch (err) {
    res.status(500).json(generateResponse('error', '', err.message));
  }
};
