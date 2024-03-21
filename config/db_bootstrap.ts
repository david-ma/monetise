import { Options, Sequelize, Transaction } from 'sequelize'
import { dbFactory } from '../models'
import { seqObject } from 'thalia'

let seqOptions: Options = {
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
}

if (process.env.NODE_ENV === 'docker') {
  seqOptions.host = 'db'
  seqOptions.port = 5432
}

const seq: seqObject = dbFactory(seqOptions)

seq.sequelize.sync({
  // force: true,
  // alter: true,
})

exports.seqOptions = seqOptions
exports.seq = seq
