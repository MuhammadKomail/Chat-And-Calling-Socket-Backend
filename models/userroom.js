"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class UserRoom extends Model {
    static associate(models) {
      UserRoom.belongsTo(models.Room, {
        foreignKey: "roomId",
        onDelete: "CASCADE",
      });
      UserRoom.belongsTo(models.User, {
        foreignKey: "userId",
        onDelete: "CASCADE",
      });
    }
  }
  UserRoom.init(
    {
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      roomId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      joinRoom: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      leaveRoom: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "UserRoom",
    }
  );
  return UserRoom;
};
