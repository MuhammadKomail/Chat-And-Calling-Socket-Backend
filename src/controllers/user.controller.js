const { generateResponse } = require("../utils/helper");
const { User, MapUser } = require("../../models");
const axios = require("axios");
const { MAIN_SERVER_URL } = require("../utils/constants");
module.exports.register = async (req, res) => {
  const { name, email, profilePic } = req.body;
  let user = "";
  if (!name || !email || !profilePic)
    return res
      .status(200)
      .json(generateResponse("failure", "", "Required Fields are missing"));

  try {

    user = await User.findOne({ where: { email } });
    if (!user?.dataValues.id) {
      user = await User.create({ name, email, profilePic });
    }
    return res.status(200).json(
      generateResponse("success", {
        data: user?.dataValues,
        content: "User Registered Successfully",
      })
    );
  } catch (error) {
    console.log(error);
    return res
      .status(200)
      .json(generateResponse("failure", "", { errorMessage: error?.message }));
  }
};

module.exports.checkUserExists = async (req, res) => {
  try {
    const user = await User.findOne({ where: { id: req.params.id } });
    if (user) {
      return res.status(200).json(generateResponse("success", { exists: true }));
    } else {
      return res.status(200).json(generateResponse("success", { exists: false }));
    }
  } catch (error) {
    res
      .status(400)
      .json(generateResponse("failure", "", "Something went wrong"));
  }
};

module.exports.getUserById = async (req, res) => {
  try {
    const user = await User.findOne({ where: { id: req.params.id } });
    if (user) {
      return res.status(200).json(generateResponse("success", { data: user }));
    } else {
      return res.status(404).json(generateResponse("failure", "", "User not found"));
    }
  } catch (error) {
    res
      .status(400)
      .json(generateResponse("failure", "", "Something went wrong"));
  }
};

module.exports.getActiveUsers = async (req, res) => {
  try {
    // Return all users. LEFT JOIN on MapUser keeps users even if not currently mapped (offline)
    const users = await User.findAll({
      include: [{
        model: MapUser,
        attributes: [],
        required: false // LEFT JOIN
      }]
    });

    const formattedUsers = users.map(user => ({
      userId: user.id,
      User: user
    }));

    res.status(200).json(generateResponse("success", { data: formattedUsers }, ""));
  } catch (error) {
    console.error("Error fetching active users:", error);
    res
      .status(500)
      .json(generateResponse("error", "", "Something went wrong"));
  }
};
