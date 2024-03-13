import { Sequelize, DataTypes, Model, BuildOptions } from 'sequelize'

export interface VisitorAttributes {
  ip: string
  userAgent: string
}
export interface VisitorModel
  extends Model<VisitorAttributes>,
    VisitorAttributes {}
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
  visitors: VisitorModel[]
}
export interface SiteModel extends Model<SiteAttributes>, SiteAttributes {}
export class Site extends Model<SiteModel, SiteAttributes> {
  public url!: string
  public title!: string
  public description!: string
  public keywords!: string
  public visitors!: VisitorModel[]
}
export type SiteStatic = typeof Model & {
  new (values?: object, options?: BuildOptions): SiteModel
}
export function SiteFactory(sequelize: Sequelize): SiteStatic {
  return <SiteStatic>sequelize.define('Site', {
    url: DataTypes.STRING,
    title: DataTypes.STRING,
    description: DataTypes.STRING,
    keywords: DataTypes.STRING,
  })
}