export type SmugMugCredentials = {
  consumer_key: string
  consumer_secret: string
  oauth_token: string
  oauth_token_secret: string
}

const REQUIRED_ENV = [
  'SMUGMUG_CONSUMER_KEY',
  'SMUGMUG_CONSUMER_SECRET',
  'SMUGMUG_OAUTH_TOKEN',
  'SMUGMUG_OAUTH_TOKEN_SECRET',
] as const

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(
      `Missing ${name}. Set SmugMug credentials in .env (see .env.example).`,
    )
  }
  return value
}

/** Load SmugMug OAuth credentials from environment variables (Bun loads .env automatically). */
export function loadSmugMugCreds(): SmugMugCredentials {
  for (const name of REQUIRED_ENV) {
    if (!process.env[name]?.trim()) {
      throw new Error(
        `Missing SmugMug credentials. Required in .env: ${REQUIRED_ENV.join(', ')}`,
      )
    }
  }

  return {
    consumer_key: requireEnv('SMUGMUG_CONSUMER_KEY'),
    consumer_secret: requireEnv('SMUGMUG_CONSUMER_SECRET'),
    oauth_token: requireEnv('SMUGMUG_OAUTH_TOKEN'),
    oauth_token_secret: requireEnv('SMUGMUG_OAUTH_TOKEN_SECRET'),
  }
}

/** Album key from SMUGMUG_ALBUM, or fallback when unset. */
export function loadSmugMugAlbum(fallback = '2qwT3k'): string {
  return process.env.SMUGMUG_ALBUM?.trim() || fallback
}
