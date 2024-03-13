"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const models_1 = require("../models");
let seqOptions = {
    dialect: 'sqlite',
    storage: `${__dirname}/database.sqlite`,
    logging: false,
    dialectOptions: {
        decimalNumbers: true,
    },
    define: {
        underscored: true,
    },
};
const sequelize = new sequelize_1.Sequelize(seqOptions);
const seq = {
    sequelize,
    Site: (0, models_1.SiteFactory)(sequelize),
    Visitor: (0, models_1.VisitorFactory)(sequelize)
};
seq.sequelize.sync({
    force: true,
    alter: true,
});
