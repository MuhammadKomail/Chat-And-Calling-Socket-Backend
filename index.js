const dotenv = require("dotenv");
const cors = require("cors");
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const app = express();
const { Server } = require("socket.io");

const routing = require("./src/route");
// Ensure we always load the .env that sits next to this file (works under PM2 too)
dotenv.config({ path: path.resolve(__dirname, ".env") });

// Fallback to 3000 if PORT isn't provided via env/PM2
const defaultPort = 3000;
const port = Number(process.env.PORT) || defaultPort;

// Visible startup diagnostics
console.log("NODE_ENV:", process.env.NODE_ENV || "development");
console.log("Effective PORT:", port);

app.use(
  cors({
    origin: "*",
  })
);

app.use(express.json()); //body parser
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files (so we can open simple_chat_client.html via http://<LAN-IP>:<PORT>/simple_chat_client.html)
app.use(express.static(path.join(__dirname)));

routing(app);

let server = app.listen(port, '0.0.0.0', () => {
  console.log(`Server Running on PORT ${port} (effective port)`);
});

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});
global.ioInstance = io;
require("./src/services/socket");
