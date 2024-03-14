"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const seq = (0, models_1.dbFactory)(seqOptions);
seq.sequelize.sync({});
exports.seq = seq;
