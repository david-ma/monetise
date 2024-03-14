import { Sequelize, DataTypes, Model, BuildOptions, Options } from 'sequelize'

export interface VisitorAttributes {
  ip: string
  userAgent: string
}
export interface VisitorModel
  extends Model<VisitorAttributes>,
    VisitorAttributes {
  addSite(site: SiteModel): void
}
export class Visitor extends Model<VisitorModel, VisitorAttributes> {
  public ip!: string
  public userAgent!: string
}
export type VisitorStatic = typeof Model & {
  new (values?: object, options?: BuildOptions): VisitorModel
}
export function VisitorFactory(sequelize: Sequelize): VisitorStatic {
  return <VisitorStatic>sequelize.define('Visitor', {
    ip: DataTypes.STRING,
    userAgent: DataTypes.STRING,
  })
}

export interface SiteAttributes {
  url: string
  title: string
  description: string
  keywords: string
}
export class Site extends Model {
  public id!: number

  public url!: string
  public title!: string
  public description!: string
  public keywords!: string

  // https://sequelize.org/docs/v6/core-concepts/model-basics/#taking-advantage-of-models-being-classes
  isDescribed() {
    return this.description && this.description.length > 0
  }

  addVisitor(visitor: VisitorModel) {
    visitor.addSite(this)
  }
}

export interface SiteModel extends Model<SiteAttributes>, SiteAttributes {
  addVisitor(visitor: VisitorModel): void
}

export type SiteStatic = typeof Model & {
  new (values?: object, options?: BuildOptions): SiteModel
}
export function SiteFactory(sequelize: Sequelize): SiteStatic {
  return Site.init(
    {
      url: DataTypes.STRING,
      title: DataTypes.STRING,
      description: DataTypes.STRING,
      keywords: DataTypes.STRING,
    },
    {
      sequelize,
      tableName: 'sites',
    }
  )
}

import { seqObject } from 'thalia'
export function dbFactory(seqOptions: Options): seqObject {
  const sequelize = new Sequelize(seqOptions)
  const Site = SiteFactory(sequelize)
  const Visitor = VisitorFactory(sequelize)
  Site.belongsToMany(Visitor, { through: 'SiteVisitor' })
  Visitor.belongsToMany(Site, { through: 'SiteVisitor' })

  return {
    sequelize,
    Site,
    Visitor,
  }
}
