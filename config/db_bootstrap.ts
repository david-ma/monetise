import { Options, Sequelize } from 'sequelize'
import { dbFactory } from '../models'
import { seqObject } from 'thalia'

let seqOptions: Options = {
  dialect: 'sqlite',
  storage: `${__dirname}/database.sqlite`,
  logging: false,
  dialectOptions: {
    decimalNumbers: true,
  },
  define: {
    underscored: true,
  },
}

const seq: seqObject = dbFactory(seqOptions)

seq.sequelize.sync({
  // force: true,
  // alter: true,
})

exports.seq = seq
