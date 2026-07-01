import { Sequelize, DataTypes, Model, BuildOptions, Options } from 'sequelize'

export interface VisitorAttributes {
  ip: string
  userAgent: string
}
export interface VisitorModel
  extends Model<VisitorAttributes>,
    VisitorAttributes {
  createdAt: Date
  addSite(site: SiteModel): void
  getSites(): Promise<SiteModel[]>
  countSites(): Promise<number>
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
    const thatSite: SiteModel = this
    return visitor.getSites().then((sites) => {
      if (sites.find((site) => site.id === thatSite.id)) {
        return null
      }

      visitor.addSite(thatSite)

      return [thatSite, visitor]
    }, console.error)
  }
}

export interface SiteModel extends Model<SiteAttributes>, SiteAttributes {
  id: number
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

export interface PaintingAttributes {
  id: number
  title: string
  yearStart: number
  yearEnd?: number
  url?: string
  imageKey?: string
  filename?: string
}
export interface PaintingModel
  extends Model<PaintingAttributes>,
    PaintingAttributes {}
export class painting extends Model {
  public id!: number
  public title!: string
  public yearStart!: number
  public yearEnd?: number
  public url?: string
  public imageKey?: string
  public filename?: string
}
export type PaintingStatic = typeof Model & {
  new (values?: object, options?: BuildOptions): PaintingModel
}
export function PaintingFactory(sequelize: Sequelize): PaintingStatic {
  return painting.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
      },
      title: DataTypes.STRING,
      yearStart: DataTypes.INTEGER,
      yearEnd: DataTypes.INTEGER,
      url: DataTypes.STRING,
      imageKey: DataTypes.STRING,
      filename: DataTypes.STRING,
    },
    {
      sequelize,
      tableName: 'paintings',
    }
  )
}

export interface MonetiseDb {
  sequelize: Sequelize
  Site: SiteStatic
  Visitor: VisitorStatic
  Painting: PaintingStatic
}

// export interface SiteVisitorAttributes {
//   SiteId: number
//   VisitorId: number
//   visits: number
// }

// export class SiteVisitor extends Model<SiteVisitorAttributes> {
//   public SiteId!: number
//   public VisitorId!: number
//   public visits!: number
// }

// export function SiteVisitorFactory(sequelize: Sequelize) {
//   return SiteVisitor.init(
//     {
//       visits: {
//         type: DataTypes.INTEGER,
//         defaultValue: 1,
//       },
//       SiteId: {
//         type: DataTypes.INTEGER,
//         references: {
//           model: Site,
//           key: 'id',
//         },
//       },
//       VisitorId: {
//         type: DataTypes.INTEGER,
//         references: {
//           model: Visitor,
//           key: 'id',
//         },
//       },
//     },
//     {
//       sequelize,
//       tableName: 'SiteVisitorTest',
//     }
//   )
// }

export function dbFactory(seqOptions: Options): MonetiseDb {
  const sequelize = new Sequelize(seqOptions)
  const Site = SiteFactory(sequelize)
  const Visitor = VisitorFactory(sequelize)
  const Painting = PaintingFactory(sequelize)
  // const SiteVisitor = SiteVisitorFactory(sequelize)

  Site.belongsToMany(Visitor, { through: 'SiteVisitor' })
  Visitor.belongsToMany(Site, { through: 'SiteVisitor' })

  return {
    sequelize,
    Site,
    Visitor,
    Painting,
  }
}
