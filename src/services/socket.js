const { MapUser, User, Room, UserRoom, Message } = require("../../models");
const db = require("../../models");
const io = global?.ioInstance;
const pushService = require('./push');

// In-memory map of which room a user is actively viewing: userId -> roomId
// This is volatile and resets on server restart, which is fine for presence-like state.
const activeRoomByUser = new Map();
// Presence: userId -> { state: 'active'|'background'|'inactive'|'offline', online: boolean, updatedAt: number }
const userPresence = new Map();
// Call state in-memory
// roomId -> { fromUserId, toUserId, type: 'audio'|'video', status: 'ringing'|'connected'|'ended', timeoutId?: any }
const callByRoom = new Map();
// userId -> roomId (to detect busy)
const userInCall = new Map();

/* Register Events */

io?.on("connection", (socket) => {
  console.log("Socket Connect Successfully");

  /* On Registration */
  socket.on("mapUser", async (userId) => {
    try {
      if (!userId)
        return socket.emit("mapUserError", {
          message: "User Id Missing",
        });

      // ====== Call Signaling Handlers ======
      // helper to emit to a specific user's active socket
      async function emitToUser(userId, event, data) {
        try {
          const map = await MapUser.findOne({ where: { userId } });
          const sid = map?.dataValues?.socketId;
          if (sid) io.to(sid).emit(event, data);
        } catch (e) { console.log('emitToUser error', e); }
      }

      function clearCall(roomId) {
        const call = callByRoom.get(String(roomId));
        if (call?.timeoutId) {
          try { clearTimeout(call.timeoutId); } catch { }
        }
        if (call) {
          userInCall.delete(String(call.fromUserId));
          userInCall.delete(String(call.toUserId));
        }
        callByRoom.delete(String(roomId));
      }

      // Replace existing call handlers with these fixed versions

      socket.on('initiateCall', async (payload) => {
        try {
          const fromUserId = payload?.fromUserId != null ? String(payload.fromUserId) : undefined;
          const toUserId = payload?.toUserId != null ? String(payload.toUserId) : undefined;
          const roomId = payload?.roomId != null ? String(payload.roomId) : undefined;
          const type = payload?.type === 'video' ? 'video' : 'audio';

          console.log('[Call] Initiate call:', { fromUserId, toUserId, roomId, type });

          if (!fromUserId || !toUserId || !roomId) {
            return socket.emit('callError', { roomId, message: 'Missing fields' });
          }

          // Busy check
          if (userInCall.has(toUserId) || userInCall.has(fromUserId)) {
            console.log('[Call] User busy:', { toUserId, fromUserId });
            socket.emit('callRejected', { roomId, reason: 'busy' });
            await emitToUser(toUserId, 'callRejected', { roomId, reason: 'busy' });
            return;
          }

          // Set call state
          callByRoom.set(roomId, { fromUserId, toUserId, type, status: 'ringing' });
          userInCall.set(fromUserId, roomId);
          userInCall.set(toUserId, roomId);

          // Ringing timeout 30s
          const timeoutId = setTimeout(async () => {
            console.log('[Call] Timeout for room:', roomId);
            try {
              await emitToUser(fromUserId, 'callRejected', { roomId, reason: 'timeout' });
              await emitToUser(toUserId, 'callCanceled', { roomId });
            } catch { }
            clearCall(roomId);
          }, 30000);

          const callState = callByRoom.get(roomId) || {};
          callState.timeoutId = timeoutId;
          callByRoom.set(roomId, callState);

          // Resolve caller display info
          let fromUserName, fromUserAvatar;
          try {
            const fromUser = await User.findOne({ where: { id: fromUserId } });
            fromUserName = fromUser?.dataValues?.name;
            fromUserAvatar = fromUser?.dataValues?.profilePic;
          } catch (e) {
            console.log('[Call] Error fetching user info:', e);
          }

          // Check if callee is online
          const presence = userPresence.get(String(toUserId));
          const isOnline = presence && presence.online === true;

          console.log('[Call] Callee presence:', { toUserId, isOnline, presence });

          if (isOnline) {
            // User is online, send socket event
            try {
              await emitToUser(toUserId, 'incomingCall', {
                fromUserId,
                roomId,
                type,
                fromUserName,
                fromUserAvatar,
                callerId: fromUserId // Add for compatibility
              });
              console.log('[Call] Socket event sent to online user');
            } catch (e) {
              console.log('[Call] Socket emit error, falling back to push:', e);
              // Fallback to push even for online users
              await sendPushNotification();
            }
          } else {
            // User is offline/background, send push notification
            await sendPushNotification();
          }

          // Send push notification function
          async function sendPushNotification() {
            try {
              const callee = await User.findOne({ where: { id: toUserId } });
              const fcmToken = callee?.dataValues?.fcmToken;

              console.log('[Call] Sending push notification:', {
                toUserId,
                fcmToken: fcmToken ? 'present' : 'missing'
              });

              if (fcmToken && pushService?.sendIncomingCallNotification) {
                await pushService.sendIncomingCallNotification(fcmToken, {
                  title: fromUserName || 'Incoming Call',
                  body: `${type === 'video' ? 'Video' : 'Audio'} call`,
                  data: {
                    roomId,
                    fromUserId,
                    callType: type,
                    fromUserName,
                    fromUserAvatar,
                    callerId: fromUserId // Add for compatibility
                  },
                });
                console.log('[Call] Push notification sent successfully');
              } else {
                console.log('[Call] No FCM token or push service unavailable');
              }
            } catch (e) {
              console.error('[Call] Push notification error:', e);
            }
          }

          // Acknowledge to caller
          socket.emit('callRinging', { roomId });
          console.log('[Call] Call initiated successfully');

        } catch (e) {
          console.error('[Call] initiateCall error:', e);
          socket.emit('callError', { roomId: payload?.roomId, message: 'initiateCall error' });
        }
      });

      // Fix other call events to match frontend expectations
      socket.on('cancelCall', async (payload) => {
        try {
          const fromUserId = payload?.fromUserId != null ? String(payload.fromUserId) : undefined;
          const toUserId = payload?.toUserId != null ? String(payload.toUserId) : undefined;
          const roomId = payload?.roomId != null ? String(payload.roomId) : undefined;

          console.log('[Call] Cancel call:', { fromUserId, toUserId, roomId });

          if (!fromUserId || !toUserId || !roomId) return;

          await emitToUser(toUserId, 'callCanceled', { roomId });
          clearCall(roomId);
        } catch (e) {
          console.error('[Call] cancelCall error:', e);
        }
      });

      socket.on('acceptCall', async (payload) => {
        try {
          const fromUserId = payload?.fromUserId != null ? String(payload.fromUserId) : undefined;
          const toUserId = payload?.toUserId != null ? String(payload.toUserId) : undefined;
          const roomId = payload?.roomId != null ? String(payload.roomId) : undefined;

          console.log('[Call] Accept call:', { fromUserId, toUserId, roomId });

          if (!fromUserId || !toUserId || !roomId) return;

          const call = callByRoom.get(String(roomId));
          if (!call) {
            console.log('[Call] No call found for room:', roomId);
            return;
          }

          call.status = 'connected';
          if (call.timeoutId) {
            try { clearTimeout(call.timeoutId); } catch { }
            call.timeoutId = null;
          }
          callByRoom.set(String(roomId), call);

          await emitToUser(toUserId, 'callAccepted', { roomId });
          socket.emit('callAccepted', { roomId });

          console.log('[Call] Call accepted successfully');
        } catch (e) {
          console.error('[Call] acceptCall error:', e);
        }
      });

      socket.on('rejectCall', async (payload) => {
        try {
          const fromUserId = payload?.fromUserId != null ? String(payload.fromUserId) : undefined;
          const toUserId = payload?.toUserId != null ? String(payload.toUserId) : undefined;
          const roomId = payload?.roomId != null ? String(payload.roomId) : undefined;
          const reason = payload?.reason || 'declined';

          console.log('[Call] Reject call:', { fromUserId, toUserId, roomId, reason });

          if (!fromUserId || !toUserId || !roomId) return;

          await emitToUser(toUserId, 'callRejected', { roomId, reason });
          clearCall(roomId);
        } catch (e) {
          console.error('[Call] rejectCall error:', e);
        }
      });

      socket.on('endCall', async (payload) => {
        try {
          const fromUserId = payload?.fromUserId != null ? String(payload.fromUserId) : undefined;
          const toUserId = payload?.toUserId != null ? String(payload.toUserId) : undefined;
          const roomId = payload?.roomId != null ? String(payload.roomId) : undefined;

          console.log('[Call] End call:', { fromUserId, toUserId, roomId });

          if (!fromUserId || !toUserId || !roomId) return;

          await emitToUser(toUserId, 'callEnded', { roomId });
          socket.emit('callEnded', { roomId });
          clearCall(roomId);
        } catch (e) {
          console.error('[Call] endCall error:', e);
        }
      });

      // Forward WebRTC SDP and ICE candidates between peers
      socket.on('rtc:offer', async (payload) => {
        try {
          const toUserId = payload?.toUserId != null ? String(payload.toUserId) : undefined;
          const roomId = payload?.roomId != null ? String(payload.roomId) : undefined;
          const sdp = payload?.sdp;
          if (!toUserId || !roomId || !sdp) return;
          await emitToUser(toUserId, 'rtc:offer', { roomId, sdp, fromUserId: payload?.fromUserId });
        } catch (e) { console.log('rtc:offer error', e); }
      });

      socket.on('rtc:answer', async (payload) => {
        try {
          const toUserId = payload?.toUserId != null ? String(payload.toUserId) : undefined;
          const roomId = payload?.roomId != null ? String(payload.roomId) : undefined;
          const sdp = payload?.sdp;
          if (!toUserId || !roomId || !sdp) return;
          await emitToUser(toUserId, 'rtc:answer', { roomId, sdp, fromUserId: payload?.fromUserId });
        } catch (e) { console.log('rtc:answer error', e); }
      });

      socket.on('rtc:ice-candidate', async (payload) => {
        try {
          const toUserId = payload?.toUserId != null ? String(payload.toUserId) : undefined;
          const roomId = payload?.roomId != null ? String(payload.roomId) : undefined;
          const candidate = payload?.candidate;
          if (!toUserId || !roomId || !candidate) return;
          await emitToUser(toUserId, 'rtc:ice-candidate', { roomId, candidate, fromUserId: payload?.fromUserId });
        } catch (e) { console.log('rtc:ice-candidate error', e); }
      });

      // Presence sweeper: mark users offline if stale
      if (!global.__presenceSweeperStarted && io) {
        global.__presenceSweeperStarted = true;
        const STALE_MS = 45 * 1000; // 45 seconds
        setInterval(() => {
          try {
            const now = Date.now();
            for (const [uid, p] of userPresence.entries()) {
              const last = Number(p?.updatedAt || 0);
              const isStale = !last || (now - last > STALE_MS);
              if (isStale && p?.online !== false) {
                userPresence.set(uid, { state: 'offline', online: false, updatedAt: now });
                io.emit('userPresence', { userId: uid, online: false, state: 'offline' });
              }
            }
          } catch (e) {
            console.log('presence sweeper error', e);
          }
        }, 15000);
      }

      // Presence: client informs server of app state changes
      socket.on('appState', (payload) => {
        try {
          const userId = payload?.userId != null ? String(payload.userId) : undefined;
          const state = payload?.state || 'inactive'; // 'active' | 'background' | 'inactive'
          if (!userId) return;
          const online = state === 'active';
          userPresence.set(userId, { state, online, updatedAt: Date.now() });
          // Broadcast to all (or could restrict to friends/rooms if needed)
          io.emit('userPresence', { userId, online, state });
        } catch (e) {
          console.log('appState error', e);
        }
      });

      // Query presence for a user; supports callback ack
      socket.on('getPresence', (payload, cb) => {
        try {
          const userId = payload?.userId != null ? String(payload.userId) : undefined;
          if (!userId) return typeof cb === 'function' && cb({ ok: false });
          const p = userPresence.get(userId) || { state: 'offline', online: false };
          if (typeof cb === 'function') cb({ ok: true, userId, online: Boolean(p.online), state: p.state });
        } catch (e) {
          if (typeof cb === 'function') cb({ ok: false });
        }
      });

      const user = await User.findOne({ where: { id: userId } });
      if (!user?.dataValues?.id) {
        return socket.emit("mapUserError", {
          message: "User not found",
        });
      }

      const alreadyExistSync = await MapUser.findOne({ where: { userId } });
      if (alreadyExistSync?.dataValues?.id) {
        // Update the socketId to the latest connection (re-sync)
        await MapUser.update(
          { socketId: socket?.id },
          { where: { id: alreadyExistSync.dataValues.id } }
        );
        socket.emit("mapUserSuccess", {
          id: alreadyExistSync.dataValues.id,
          message: "User re-synced with new socketId",
        });
      } else {
        let res = await MapUser.create({
          userId,
          socketId: socket?.id,
        });
        socket.emit("mapUserSuccess", {
          id: res?.dataValues?.id,
        });
      }
      // remember which user is tied to this socket for cleanup
      try { socket.data.userId = userId; } catch { }
    } catch (error) {
      console.log({ error });
      socket.emit("mapUserError", {
        message: error?.message,
      });
    }
  });

  // Track active room presence for a user
  socket.on('activeRoom', (payload) => {
    try {
      const userId = payload?.userId != null ? String(payload.userId) : undefined;
      const roomId = payload?.roomId != null ? String(payload.roomId) : undefined;
      if (!userId || !roomId) return;
      activeRoomByUser.set(userId, roomId);
    } catch (e) {
      console.log('activeRoom error', e);
    }
  });

  socket.on('inactiveRoom', (payload) => {
    try {
      const userId = payload?.userId != null ? String(payload.userId) : undefined;
      const roomId = payload?.roomId != null ? String(payload.roomId) : undefined;
      if (!userId) return;
      const current = activeRoomByUser.get(userId);
      if (!roomId || current === String(roomId)) {
        activeRoomByUser.delete(userId);
      }
    } catch (e) {
      console.log('inactiveRoom error', e);
    }
  });

  /* Room Creation Handler */

  socket.on("createRoom", async (payload) => {
    try {
      console.log('payload: ', payload);
      const user = await User.findOne({
        where: { id: payload?.userId },
      });
      console.log({ user });
      if (!user?.dataValues?.id)
        return socket.emit("roomCreationError", {
          message: "Room Creator Not Found",
        });
      let room = await Room.create({
        userId: payload?.userId,
        startTime: new Date(),
      });

      let infoArr = [];
      if (payload?.selectedUsers?.length) {
        for (let index = 0; index < payload?.selectedUsers?.length; index++) {
          let isFound = await User.findOne({
            where: { id: payload?.selectedUsers[index] },
          });
          if (isFound?.dataValues?.id) {
            infoArr.push({
              id: isFound?.dataValues?.id,
              name: isFound?.dataValues?.name,
            });
          }



        }
      }

      if (payload?.selectedUsers?.length) {
        for (let index = 0; index < payload?.selectedUsers?.length; index++) {
          let isFound = await MapUser.findOne({
            where: { userId: payload?.selectedUsers[index] },
          });
          if (!isFound?.dataValues?.id)
            socket.emit("roomCreationError", {
              message: "Room Participant Not Found",
            });

          socket.broadcast.emit("roomInvitations", {
            message: `${user?.dataValues?.name} Created a call would you like to join`,
            roomId: room?.dataValues?.id,
            selectedUsers: payload?.selectedUsers,
            creatorId: user?.dataValues?.id,
            selectedUserInformation: infoArr
          });
        }
      }
      // await room.addUser(user);
      await UserRoom.create({
        userId: user?.dataValues?.id,
        roomId: room?.dataValues?.id,
        joinRoom: Date.now(),
      });
      let roomId = room.dataValues.id;
      await socket.join(roomId);
      console.log(`Socket ${socket.id} joined room ${roomId}`);
      socket.emit("userJoined", {
        message: `${user.dataValues.name} joined the call`,
        roomId,
        userId: user?.dataValues?.id
      });
    } catch (error) {
      console.log({ error });
      return socket.emit("roomCreationError", {
        message: "Something went wrong while creating room",
      });
    }
  });

  /* Joining Room Handler */

  socket.on("joinRoom", async (payload) => {
    try {
      if (!payload?.roomId || !payload?.joinUser)
        return socket.emit("joiningRoomError", {
          message: "Required Fields are missing",
        });
      let user = await User.findOne({ where: { id: payload.joinUser } });
      if (!user?.dataValues?.id)
        return socket.emit("joiningRoomError", {
          message: "User Not Found",
        });

      let alreadyJoinUser = await UserRoom.findOne({
        where: { userId: payload?.joinUser, roomId: payload?.roomId },
      });
      if (!alreadyJoinUser?.dataValues?.id) {
        await UserRoom.create({
          roomId: payload?.roomId,
          userId: payload?.joinUser,
          joinRoom: new Date(Date.now()),
        });
      }

      await socket.join(payload.roomId);
      return socket.to(payload.roomId).emit("userJoined", {
        message: `${user?.dataValues?.name} Join the call`,
        roomId: payload.roomId,
        userId: user?.dataValues?.id
      });
    } catch (error) {
      console.log(error);
      return socket.emit("joiningRoomError", {
        message: "Something went wrong while joining the room",
      });
    }
  });

  /* Leaving Room Handler */

  socket.on("leaveRoom", async (payload) => {
    try {
      if (!payload?.roomId || !payload?.userId)
        return socket.emit("leaveRoomError", {
          message: "Error In Leaving Call",
        });
      await socket.leave(payload.roomId);
      await UserRoom.update(
        { leaveRoom: new Date(Date.now()) },
        { where: { userId: payload?.userId } }
      );
      return socket.emit("leaveRoomSuccess", {
        message: "Leave the room successfully",
      });
    } catch (error) {
      console.log({ error });
      return socket.emit("leaveRoomError", {
        message: "Error In Leaving Call",
      });
    }
  });

  /* Room Message Handler */

  socket.on("roomMessage", async (payload) => {
    const { userId, roomId, message, name, isSaveInDb } = payload;
    if (!userId || !roomId || !message || !name)
      return socket.emit("errorInRoomMessage", {
        message: "Required Fields are missing",
      });
    try {
      // Resolve sender details for accurate notification title and avatar
      const sender = await User.findOne({ where: { id: userId } });
      const senderName = sender?.dataValues?.name || name;
      const senderAvatar = sender?.dataValues?.profileImage || 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSBX1YnE-LUZJRytYGwgNgkPCk15xuGY3tcvA&s';

      console.log('sender: ', sender);
      console.log('senderName: ', senderName);
      console.log('senderAvatar: ', senderAvatar);
      let savedMessage;
      if (isSaveInDb) savedMessage = await Message.create({ userId, roomId, message });
      // Send message to all clients in the room except the sender
      socket.to(roomId).emit("roomMessageDeliver", {
        message,
        name,
        userId,
        roomId,
        createdAt: savedMessage?.createdAt,
      });

      // Notify the recipient with the new unread message count
      const roomMembers = await UserRoom.findAll({ where: { roomId: roomId } });

      // Check if this is a private room (only 2 members)
      if (roomMembers.length === 2) {
        for (const member of roomMembers) {
          if (Number(member.userId) !== Number(userId)) { // This is the recipient
            const recipientSocket = await MapUser.findOne({ where: { userId: member.userId } });
            if (recipientSocket?.dataValues?.socketId) {
              // Calculate unread messages from the sender to the recipient in this private room
              const unreadCount = await Message.count({
                where: {
                  roomId: roomId,
                  userId: userId, // Messages sent by the sender
                  isRead: false
                }
              });

              // Emit to the recipient's socket with sender info for chat list updates
              io.to(recipientSocket.dataValues.socketId).emit('updateUnreadCount', {
                senderId: userId, // The user who sent the message
                recipientId: member.userId, // The user receiving the message
                roomId: roomId,
                unreadCount: unreadCount
              });

              // Also emit a lightweight last message update to recipient (works even if not joined room)
              io.to(recipientSocket.dataValues.socketId).emit('lastMessageUpdate', {
                roomId: roomId,
                otherUserId: userId,
                message: message,
                createdAt: savedMessage?.createdAt || new Date(),
                fromMe: false
              });

              // And emit to sender so their list updates too
              socket.emit('lastMessageUpdate', {
                roomId: roomId,
                otherUserId: member.userId,
                message: message,
                createdAt: savedMessage?.createdAt || new Date(),
                fromMe: true
              });
              // Additionally, send push notification only if recipient is NOT actively viewing this room
              const activeRoom = activeRoomByUser.get(String(member.userId));
              if (String(activeRoom) !== String(roomId)) {
                const recipient = await User.findOne({ where: { id: member.userId } });
                if (recipient?.dataValues?.fcmToken) {
                  await pushService.sendMessageNotification(recipient.dataValues.fcmToken, {
                    title: senderName,
                    body: message,
                    data: { roomId, senderId: userId }
                  });
                }
              }
            } else {
              // No active socket: try to send push notification
              const recipient = await User.findOne({ where: { id: member.userId } });
              if (recipient?.dataValues?.fcmToken) {
                await pushService.sendMessageNotification(recipient.dataValues.fcmToken, {
                  title: senderName,
                  body: message,
                  data: { roomId, senderId: userId }
                });
              }
            }
          }
        }
      } else {
        // For group chats, use the original logic
        for (const member of roomMembers) {
          if (Number(member.userId) !== Number(userId)) { // This is the recipient
            const recipientSocket = await MapUser.findOne({ where: { userId: member.userId } });
            if (recipientSocket?.dataValues?.socketId) {
              // Calculate the total unread messages for the recipient in this room
              const unreadCount = await Message.count({
                where: {
                  roomId: roomId,
                  userId: { [db.Sequelize.Op.ne]: member.userId }, // Messages not from the recipient
                  isRead: false
                }
              });

              io.to(recipientSocket.dataValues.socketId).emit('updateUnreadCount', {
                senderId: userId, // The user who sent the message
                roomId: roomId,
                unreadCount: unreadCount
              });
              // Additionally, send push notification only if recipient is NOT actively viewing this room
              const activeRoom = activeRoomByUser.get(String(member.userId));
              if (String(activeRoom) !== String(roomId)) {
                const recipient = await User.findOne({ where: { id: member.userId } });
                if (recipient?.dataValues?.fcmToken) {
                  await pushService.sendMessageNotification(recipient.dataValues.fcmToken, {
                    title: senderName,
                    body: message,
                    data: { roomId, senderId: userId }
                  });
                }
              }
            } else {
              // No active socket: send push if token exists
              const recipient = await User.findOne({ where: { id: member.userId } });
              if (recipient?.dataValues?.fcmToken) {
                await pushService.sendMessageNotification(recipient.dataValues.fcmToken, {
                  title: senderName,
                  body: message,
                  data: { roomId, senderId: userId }
                });
              }
            }
          }
        }
      }
    } catch (error) {
      console.log({ error });
      return socket.in(roomId).emit("errorInRoomMessage", {
        message: "Error In Sending Message",
      });
    }
  });

  /* Room End Handler*/

  socket.on("endRoom", async (payload) => {
    if (!payload?.roomId)
      return socket.emit("endRoomError", {
        message: "Room Id is missing",
      });

    try {
      await Room.update(
        { endTIme: new Date(Date.now()) },
        { where: { id: payload?.roomId } }
      );
      let userPromise = [];
      const users = await UserRoom.findAll({
        where: { roomId: payload?.roomId },
      });
      if (users) {
        users?.map((u) => {
          if (!u?.dataValues?.leaveRoom) {
            userPromise.push(
              UserRoom.update(
                { leaveRoom: new Date(Date.now()) },
                { where: { roomId: payload?.roomId } }
              )
            );
          }
        });
      }
      await Promise.all(userPromise);
      return socket
        .in(payload?.roomId)
        .emit("endRoomSuccess", { message: "Call end successfully" });
    } catch (error) {
      console.log({ error });
      return socket.in(payload?.roomId).emit("endRoomError", {
        message: "Something went wrong",
      });
    }
  });

  /* On Logout */
  socket.on("markAsRead", async (data) => {
    try {
      const { roomId, userId } = data;

      // Mark messages as read in database
      await Message.update(
        { isRead: true },
        {
          where: {
            roomId: roomId,
            userId: { [db.Sequelize.Op.ne]: userId }, // Messages not sent by the reader
            isRead: false
          }
        }
      );

      // Notify the other user in the room that messages have been read
      socket.to(roomId).emit("messagesRead", { roomId, readerId: userId });

      // Get room members to update unread counts
      const roomMembers = await UserRoom.findAll({ where: { roomId: roomId } });

      // Check if this is a private room (only 2 members)
      if (roomMembers.length === 2) {
        // Find the other user (sender) to notify them about read status
        const otherMember = roomMembers.find(member => member.userId !== userId);
        if (otherMember) {
          const senderSocket = await MapUser.findOne({ where: { userId: otherMember.userId } });
          if (senderSocket?.dataValues?.socketId) {
            // Emit updated unread count (should be 0 now) to the sender
            io.to(senderSocket.dataValues.socketId).emit('updateUnreadCount', {
              senderId: otherMember.userId,
              recipientId: userId,
              roomId: roomId,
              unreadCount: 0 // Messages are now read
            });
          }
        }
      }
    } catch (error) {
      console.log({ error });
    }
  });

  socket.on("logout", async (id) => {
    try {
      if (!id)
        return socket.emit("mapUserDeleteError", {
          message: "User Id Missing",
        });
      const isValid = await MapUser.findOne({ where: { userId: id } });
      if (!isValid?.dataValues?.id) {
        return socket.emit("mapUserDeleteError", {
          message: "Invalid User Id",
        });
      }

      // await MapUser.destroy({
      //   where: { userId: id },
      // });
      socket.emit("mapUserDeleteSuccess", {
        message: "Event Delete Successfully",
      });
      // socket.disconnect(true);
    } catch (error) {
      return socket.emit("mapUserDeleteError", {
        message: error?.message,
      });
    }
  });

  // Cleanup mapping on disconnect to avoid stale socketIds and active room state
  socket.on("disconnect", async () => {
    try {
      await MapUser.destroy({ where: { socketId: socket.id } });
      const uid = socket?.data?.userId != null ? String(socket.data.userId) : undefined;
      if (uid) {
        // If user was in a call, notify the peer and clear state
        try {
          const roomId = userInCall.get(String(uid));
          if (roomId) {
            const call = callByRoom.get(String(roomId));
            const fromUserId = call?.fromUserId != null ? String(call.fromUserId) : undefined;
            const toUserId = call?.toUserId != null ? String(call.toUserId) : undefined;
            const otherUserId = String(uid) === fromUserId ? toUserId : fromUserId;
            if (otherUserId) {
              try {
                const map = await MapUser.findOne({ where: { userId: otherUserId } });
                const sid = map?.dataValues?.socketId;
                if (sid) io.to(sid).emit('callEnded', { roomId: String(roomId), reason: 'peer_disconnected' });
              } catch (e) { console.log('disconnect emit callEnded error', e); }
            }
            // Clear any pending timeout and in-memory state
            try { if (call?.timeoutId) clearTimeout(call.timeoutId); } catch { }
            if (fromUserId) userInCall.delete(fromUserId);
            if (toUserId) userInCall.delete(toUserId);
            callByRoom.delete(String(roomId));
          }
        } catch (e) { console.log('disconnect call cleanup error', e); }

        activeRoomByUser.delete(uid);
        // Mark presence offline and broadcast
        userPresence.set(uid, { state: 'offline', online: false, updatedAt: Date.now() });
        io.emit('userPresence', { userId: uid, online: false, state: 'offline' });
      }
    } catch (e) {
      console.log("Error cleaning up MapUser on disconnect", e);
    }
  });
});
