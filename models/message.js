"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class Message extends Model {
    static associate(models) {
      Message.belongsTo(models.Room, {
        onDelete: "cascade",
        onUpdate: "cascade",
        foreignKey: {
          name: "roomId",
          allowNull: false,
        },
      });
      Message.belongsTo(models.User, {
        onDelete: "cascade",
        onUpdate: "cascade",
        foreignKey: {
          name: "userId",
          allowNull: false,
        },
      });
    }
  }
  Message.init(
    {
      roomId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      isRead: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      sequelize,
      modelName: "Message",
    }
  );
  return Message;
};
