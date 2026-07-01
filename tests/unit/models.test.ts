import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { dbFactory } from '../../models'

describe('monetise models', () => {
  const db = dbFactory({
    dialect: 'sqlite',
    storage: ':memory:',
    logging: false,
  })

  beforeAll(async () => {
    await db.sequelize.sync({ force: true })
  })

  afterAll(async () => {
    await db.sequelize.close()
  })

  test('dbFactory exposes Site, Visitor, and Painting models', () => {
    expect(db.Site.name).toBe('Site')
    expect(db.Visitor.name).toBe('Visitor')
    expect(db.Painting.name).toBe('painting')
  })

  test('Site.isDescribed returns false for empty description', () => {
    const site = db.Site.build({
      url: 'https://example.com',
      title: 't',
      description: '',
      keywords: 'k',
    })
    expect(site.isDescribed()).toBe(false)
  })

  test('Site.isDescribed returns true when description is set', () => {
    const site = db.Site.build({
      url: 'https://example.com',
      title: 't',
      description: 'A Monet landscape',
      keywords: 'k',
    })
    expect(site.isDescribed()).toBe(true)
  })

  test('Visitor and Site many-to-many association works', async () => {
    const [site] = await db.Site.findOrCreate({
      where: { url: 'https://example.com' },
      defaults: {
        url: 'https://example.com',
        title: 'title',
        description: 'description',
        keywords: 'keywords',
      },
    })
    const [visitor] = await db.Visitor.findOrCreate({
      where: { ip: '10.0.0.1' },
      defaults: { ip: '10.0.0.1', userAgent: 'test-agent' },
    })

    await visitor.addSite(site)
    const sites = await visitor.getSites()
    expect(sites.map((s) => s.get('url') as string)).toContain('https://example.com')
  })
})
