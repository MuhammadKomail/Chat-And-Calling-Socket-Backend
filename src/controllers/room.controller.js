const { generateResponse } = require("../utils/helper");
const { User, Room, Message, UserRoom, sequelize } = require("../../models");
const { Op, Sequelize } = require("sequelize");

module.exports.getRooms = async (req, res) => {
  try {
    if (!req.params.id)
      return res
        .status(400)
        .json(generateResponse("failure", "User Id not found", ""));
    const user = await User.findOne({ where: { id: req?.params?.id } });
    if (!user)
      return res
        .status(400)
        .json(generateResponse("failure", "User  not found", ""));
    const room = await Room.findAll({
      where: { userId: req?.params?.id },
      include: [{ model: Message, include: [{ model: User }] }],
    });
    if (!room)
      return res
        .status(400)
        .json(generateResponse("failure", "Rooms not found", ""));
    res.status(200).json(
      generateResponse(
        "success",
        {
          message: "Room & Messages found",
          data: room,
        },
        ""
      )
    );
  } catch (error) {
    console.log({ error });
    res
      .status(400)
      .send(generateResponse("failure", "", "Something went wrong"));
  }
};

// POST /api/room/bootstrap
// { userId: number, targetUserIds: number[] }
module.exports.bootstrapRooms = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { userId, targetUserIds } = req.body || {};
    if (!userId || !Array.isArray(targetUserIds)) {
      await t.rollback();
      return res
        .status(400)
        .json(generateResponse("failure", "userId and targetUserIds are required", ""));
    }

    const uniqueTargets = [...new Set(targetUserIds)].filter((id) => id && id !== userId);
    if (uniqueTargets.length === 0) {
      await t.commit();
      return res.status(200).json(generateResponse("success", { created: [], existing: [], total: 0 }, "Nothing to process"));
    }

    const created = [];
    const existing = [];

    for (const targetId of uniqueTargets) {
      // find existing private room between the two users
      const candidateRooms = await UserRoom.findAll({
        attributes: ["roomId"],
        where: { userId: { [Op.in]: [userId, targetId] } },
        group: ["roomId"],
        having: Sequelize.literal(`count(roomId) = 2`),
        transaction: t,
      });

      let matchedRoomId = null;
      for (const row of candidateRooms) {
        const cnt = await UserRoom.count({ where: { roomId: row.roomId }, transaction: t });
        if (cnt === 2) {
          matchedRoomId = row.roomId;
          break;
        }
      }

      if (matchedRoomId) {
        existing.push(targetId);
        continue;
      }

      // create new room for the pair
      const newRoom = await Room.create({ userId, startTime: new Date() }, { transaction: t });
      await UserRoom.bulkCreate(
        [
          { userId, roomId: newRoom.id, joinRoom: new Date() },
          { userId: targetId, roomId: newRoom.id, joinRoom: new Date() },
        ],
        { transaction: t }
      );
      created.push(targetId);
    }

    await t.commit();
    return res
      .status(200)
      .json(
        generateResponse(
          "success",
          { created, existing, total: created.length + existing.length },
          "Rooms bootstrapped"
        )
      );
  } catch (error) {
    console.log({ error });
    await t.rollback();
    return res.status(500).json(generateResponse("failure", "", "Something went wrong"));
  }
};

// GET /api/room/user/:userId?search=&page=1&pageSize=20
module.exports.getUserChatList = async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!userId) return res.status(400).json(generateResponse("failure", "userId required", ""));

    const search = (req.query.search || "").toString().trim();
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || "20", 10)));

    // All rooms current user participates in
    const userRooms = await UserRoom.findAll({ attributes: ["roomId"], where: { userId } });
    const roomIds = userRooms.map((ur) => ur.roomId);
    if (roomIds.length === 0) {
      return res.status(200).json(generateResponse("success", { items: [], page, pageSize, hasMore: false }, "OK"));
    }

    // Find the other participant per room
    const participants = await UserRoom.findAll({
      where: { roomId: { [Op.in]: roomIds } },
      include: [{ model: User, attributes: ["id", "name", "profilePic" /* avatar field */] }],
    });

    // Build a map: roomId -> otherUser
    const roomToOther = new Map();
    for (const p of participants) {
      if (p.userId !== userId) {
        roomToOther.set(p.roomId, p.User);
      }
    }

    // Optionally filter by search on other user name
    let filteredRoomIds = roomIds.filter((rid) => roomToOther.has(rid));
    if (search) {
      const q = search.toLowerCase();
      filteredRoomIds = filteredRoomIds.filter((rid) => {
        const u = roomToOther.get(rid);
        return (u?.name || "").toLowerCase().includes(q);
      });
    }

    // Fetch last message for each room
    const lastMessages = await Message.findAll({
      where: { roomId: { [Op.in]: filteredRoomIds } },
      order: [["createdAt", "DESC"]],
      attributes: ["id", "roomId", "message", "createdAt", "userId", "isRead"],
    });

    const roomToLast = new Map();
    for (const m of lastMessages) {
      if (!roomToLast.has(m.roomId)) {
        roomToLast.set(m.roomId, m);
      }
    }

    // Count unread per room (messages from other user to me, isRead false)
    const unreadCounts = await Message.findAll({
      where: {
        roomId: { [Op.in]: filteredRoomIds },
        isRead: false,
        userId: { [Op.ne]: userId },
      },
      attributes: [[Sequelize.fn("COUNT", Sequelize.col("id")), "count"], "roomId"],
      group: ["roomId"],
    });
    const roomToUnread = new Map();
    for (const r of unreadCounts) {
      roomToUnread.set(r.get("roomId"), Number(r.get("count")) || 0);
    }

    // Sort by last message time desc
    filteredRoomIds.sort((a, b) => {
      const ma = roomToLast.get(a);
      const mb = roomToLast.get(b);
      const ta = ma ? new Date(ma.createdAt).getTime() : 0;
      const tb = mb ? new Date(mb.createdAt).getTime() : 0;
      return tb - ta;
    });

    // Pagination
    const start = (page - 1) * pageSize;
    const pagedRoomIds = filteredRoomIds.slice(start, start + pageSize);
    const hasMore = start + pageSize < filteredRoomIds.length;

    const items = pagedRoomIds.map((rid) => {
      const otherUser = roomToOther.get(rid) || null;
      const lm = roomToLast.get(rid) || null;
      return {
        roomId: rid,
        otherUser: otherUser
          ? { id: otherUser.id, name: otherUser.name, avatar: otherUser.profilePic || null }
          : null,
        lastMessage: lm
          ? {
              id: lm.id,
              text: lm.message,
              createdAt: lm.createdAt,
              senderId: lm.userId,
              isRead: lm.isRead,
            }
          : null,
        unreadCount: roomToUnread.get(rid) || 0,
      };
    });

    return res
      .status(200)
      .json(generateResponse("success", { items, page, pageSize, hasMore }, "OK"));
  } catch (error) {
    console.log({ error });
    res.status(500).send(generateResponse("failure", "", "Something went wrong"));
  }
};

module.exports.findOrCreatePrivateRoom = async (req, res) => {
  try {
    const { userId1, userId2 } = req.body;
    if (!userId1 || !userId2) {
      return res.status(400).json(generateResponse("failure", "Both user IDs are required", ""));
    }

    // Find rooms that have both users
    const rooms = await UserRoom.findAll({
      attributes: ['roomId'],
      where: {
        userId: {
          [Op.in]: [userId1, userId2]
        }
      },
      group: ['roomId'],
      having: Sequelize.literal(`count(roomId) = 2`)
    });

    const roomIds = rooms.map(r => r.roomId);

    // Further check if these rooms have ONLY these two users
    for (const roomId of roomIds) {
      const memberCount = await UserRoom.count({ where: { roomId } });
      if (memberCount === 2) {
        return res.status(200).json(generateResponse("success", { roomId }, "Private room found"));
      }
    }

    // No existing private room found, create a new one
    const newRoom = await Room.create({ userId: userId1, startTime: new Date() });
    await UserRoom.bulkCreate([
      { userId: userId1, roomId: newRoom.id, joinRoom: new Date() },
      { userId: userId2, roomId: newRoom.id, joinRoom: new Date() }
    ]);

    res.status(201).json(generateResponse("success", { roomId: newRoom.id }, "Private room created"));

  } catch (error) {
    console.log({ error });
    res.status(500).send(generateResponse("failure", "", "Something went wrong"));
  }
};

module.exports.getUnreadCount = async (req, res) => {
  try {
    const { userId1, userId2 } = req.body; // logged-in user, other user
    if (!userId1 || !userId2) {
      return res.status(400).json(generateResponse("failure", "Both user IDs are required", ""));
    }

    // Find the private room between the two users
    const rooms = await UserRoom.findAll({
      attributes: ['roomId'],
      where: {
        userId: {
          [Op.in]: [userId1, userId2]
        }
      },
      group: ['roomId'],
      having: Sequelize.literal(`count(roomId) = 2`)
    });

    const roomIds = rooms.map(r => r.roomId);
    let privateRoomId = null;

    for (const roomId of roomIds) {
      const memberCount = await UserRoom.count({ where: { roomId } });
      if (memberCount === 2) {
        privateRoomId = roomId;
        break; // Found the private room
      }
    }

    if (!privateRoomId) {
      // No private room exists, so no unread messages
      return res.status(200).json(generateResponse("success", { data: { unreadCount: 0 } }, "No private room found."));
    }

    // Count unread messages in the private room sent by userId2 to userId1
    const unreadCount = await Message.count({
      where: {
        roomId: privateRoomId,
        userId: userId2, // Messages sent by the *other* user
        isRead: false
      }
    });

    res.status(200).json(generateResponse("success", { data: { unreadCount } }, "Unread count fetched successfully."));

  } catch (error) {
    console.log({ error });
    res.status(500).send(generateResponse("failure", "", "Something went wrong"));
  }
};

module.exports.deleteRoom = async (req, res) => {
  try {
    if (!req.params.id)
      return res
        .status(400)
        .json(generateResponse("failure", "Room Id not found", ""));
    const room = await Room.findOne({ where: { id: req?.params?.id } });
    if (!room)
      return res
        .status(400)
        .json(generateResponse("failure", "room  not found", ""));
    await Message.destroy({ where: { roomId: req?.params?.id } });
    await UserRoom.destroy({ where: { roomId: req?.params?.id } });
    await Room.destroy({ where: { id: req?.params?.id } });
    res
      .status(200)
      .json(generateResponse("success", "Room Deleted Successfully", ""));
  } catch (error) {
    console.log({ error });
    res
      .status(400)
      .send(generateResponse("failure", "", "Something went wrong"));
  }
};

module.exports.markMessagesAsRead = async (req, res) => {
  try {
    const { roomId, userId } = req.body;

    if (!roomId || !userId) {
      return res.status(400).json(generateResponse("failure", "Room ID and User ID are required.", ""));
    }

    await Message.update(
      { isRead: true },
      {
        where: {
          roomId: roomId,
          userId: { [Op.ne]: userId }, // Mark messages not sent by the current user as read
          isRead: false,
        },
      }
    );

    res.status(200).json(generateResponse("success", "Messages marked as read.", ""));
  } catch (error) {
    console.log({ error });
    res.status(500).send(generateResponse("failure", "", "Something went wrong"));
  }
};
