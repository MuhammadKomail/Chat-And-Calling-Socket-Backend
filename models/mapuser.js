"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class MapUser extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      MapUser.belongsTo(models.User, {
        onDelete: "cascade",
        onUpdate: "cascade",
        foreignKey: {
          name: "userId",
          allowNull: false,
        },
      });
    }
  }
  MapUser.init(
    {
      socketId: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "MapUser",
    }
  );
  return MapUser;
};
