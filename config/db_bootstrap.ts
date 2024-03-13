import { Options, Sequelize } from 'sequelize'
import { SiteFactory, VisitorFactory } from '../models'

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

import { seqObject } from 'thalia'
const sequelize = new Sequelize(seqOptions)
const seq: seqObject = {
  sequelize,
  Site: SiteFactory(sequelize),
  Visitor: VisitorFactory(sequelize)
}

seq.sequelize.sync({
  force: true,
  alter: true,
})
