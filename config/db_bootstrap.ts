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
const Site = SiteFactory(sequelize)
const Visitor = VisitorFactory(sequelize)
Site.belongsToMany(Visitor, { through: 'SiteVisitor' })
Visitor.belongsToMany(Site, { through: 'SiteVisitor' })

const seq: seqObject = {
  sequelize,
  Site,
  Visitor,
}

seq.sequelize.sync({
  force: true,
  alter: true,
})

exports.seq = seq