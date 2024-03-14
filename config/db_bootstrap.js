"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const models_1 = require("../models");
let seqOptions = {
    dialect: 'postgres',
    database: 'monetise',
    username: 'monetise',
    password: 'monetise_password',
    host: 'localhost',
    port: 5233,
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
