"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class Room extends Model {
    static associate(models) {
      Room.hasMany(models.Message, {
        onDelete: "cascade",
        onUpdate: "cascade",
        foreignKey: {
          name: "roomId",
          allowNull: false,
        },
      });
      Room.belongsTo(models.User, {
        onDelete: "cascade",
        onUpdate: "cascade",
        foreignKey: {
          name: "userId",
          allowNull: false,
        },
      });
      // Room.hasMany(models.UserRoom, {
      //   onDelete: "cascade",
      //   onUpdate: "cascade",
      //   foreignKey: {
      //     name: "roomId",
      //     allowNull: false,
      //   },
      // });
    }
  }
  Room.init(
    {
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      startTime: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      endTIme: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "Room",
    }
  );
  return Room;
};
