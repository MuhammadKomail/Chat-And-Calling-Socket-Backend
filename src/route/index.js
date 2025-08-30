const { generateResponse } = require("../utils/helper");
module.exports = function (app) {
  app.use("/api/user", require("./user.route"));
  app.use("/api/room", require("./room.route"));
  app.use("/api", require("./message.route")); // <-- Register message route here
  app.use("/api/notification", require("./notification.route"));

  // Catch-all should be last!
  app.get("*", (req, res) =>
    res
      .status(200)
      .send(generateResponse("success", "Welcome to Hear server", ""))
  );
};
