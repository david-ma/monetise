"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const models_1 = require("../models");
let seqOptions = {
    dialect: 'sqlite',
    storage: `${__dirname}/database.sqlite`,
    logging: false,
    transactionType: sequelize_1.Transaction.TYPES.IMMEDIATE,
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
