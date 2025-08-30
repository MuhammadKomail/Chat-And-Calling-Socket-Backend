module.exports.generateResponse = (status = "", message = "", error = "") => {
  return {
    status,
    message,
    error,
  };
};

// module.exports.checkSocketJoinTheRoomOrNot = (io, roomId, socketId) => {
//   console.log(io)
//   console.log(io?.sockets?.connected)
//   const socket = io.sockets.connected[socketId]; // Get the socket instance
//   if (socket) {
//     const roomsJoined = socket.rooms;
//     if (roomsJoined.has(roomId)) {
//       console.log(`Socket ${socketId} has joined room ${roomIdToCheck}`);
//     } else {
//       console.log(`Socket ${socketId} has NOT joined room ${roomIdToCheck}`);
//     }
//   } else {
//     console.log(`Socket ${socketId} is not available or not connected`);
//   }
// };
