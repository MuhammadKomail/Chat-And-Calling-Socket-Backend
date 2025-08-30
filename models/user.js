"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      User.hasMany(models.Room, {
        onDelete: "cascade",
        onUpdate: "cascade",
        foreignKey: {
          name: "userId",
          allowNull: false,
        },
      });
      User.hasMany(models.MapUser, {
        onDelete: "cascade",
        onUpdate: "cascade",
        foreignKey: {
          name: "userId",
          allowNull: false,
        },
      });
      // User.hasMany(models.UserRoom, {
      //   onDelete: "cascade",
      //   onUpdate: "cascade",
      //   foreignKey: {
      //     name: "userId",
      //     allowNull: false,
      //   },
      // });
    }
  }
  User.init(
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      profilePic: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      fcmToken: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "User",
    }
  );
  return User;
};
