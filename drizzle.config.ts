import { defineConfig } from 'drizzle-kit'

export const DB_USERNAME = 'monetise'
export const DB_PASSWORD = 'monetise_password'
export const DB_DATABASE = 'monetise'
export const DB_HOST = process.env.NODE_ENV === 'docker' ? 'db' : (process.env.DB_HOST ?? 'localhost')
export const DB_PORT = process.env.NODE_ENV === 'docker' ? 3306 : Number(process.env.DB_PORT ?? 5233)

const url = `mysql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_DATABASE}`

export default defineConfig({
  dialect: 'mysql',
  schema: './models/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url,
  },
})
