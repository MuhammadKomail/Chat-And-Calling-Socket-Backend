"use strict";
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("UserRooms", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        // references: {
        //   model: "Users",
        //   key: "id",
        // },
      },
      roomId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        // references: {
        //   model: "Rooms",
        //   key: "id",
        // },
      },
      joinRoom: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      leaveRoom: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("UserRooms");
  },
};
