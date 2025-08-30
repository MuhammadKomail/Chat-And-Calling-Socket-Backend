let roomRoute = require("express").Router();
let roomController = require("../controllers/room.controller");
roomRoute.get("/:id", roomController.getRooms);
roomRoute.post("/unread-count", roomController.getUnreadCount);
roomRoute.delete("/:id", roomController.deleteRoom);
roomRoute.post("/private", roomController.findOrCreatePrivateRoom);
roomRoute.post("/mark-as-read", roomController.markMessagesAsRead);
// New
roomRoute.post("/bootstrap", roomController.bootstrapRooms);
roomRoute.get("/user/:userId", roomController.getUserChatList);

module.exports = roomRoute;
