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
if (process.env.NODE_ENV === 'docker') {
    seqOptions.host = 'db';
    seqOptions.port = 5432;
}
const seq = (0, models_1.dbFactory)(seqOptions);
seq.sequelize.sync({});
exports.seqOptions = seqOptions;
exports.seq = seq;
