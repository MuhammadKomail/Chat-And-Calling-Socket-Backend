let userRouter = require("express").Router();
let userController = require("../controllers/user.controller");
userRouter.post("/register", userController.register);
userRouter.get("/activeUsers", userController.getActiveUsers)
userRouter.get("/exists/:id", userController.checkUserExists);
userRouter.get("/:id", userController.getUserById);

module.exports = userRouter;
