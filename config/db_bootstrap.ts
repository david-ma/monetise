import type { Options } from 'sequelize'
import { dbFactory, type MonetiseDb } from '../models'

const seqOptions: Options = {
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

const seq: MonetiseDb = dbFactory(seqOptions)

let dbReady = false

export async function initDb(): Promise<boolean> {
  try {
    await seq.sequelize.authenticate()
    await seq.sequelize.sync({
      // force: true,
      // alter: true,
    })
    dbReady = true
    console.log('Postgres connected for monetise')
    return true
  } catch (error) {
    dbReady = false
    console.warn(
      'Postgres unavailable — visitor tracking disabled. Start with: docker compose up db',
      error instanceof Error ? error.message : error,
    )
    return false
  }
}

export function isDbReady(): boolean {
  return dbReady
}

export { seqOptions, seq }
