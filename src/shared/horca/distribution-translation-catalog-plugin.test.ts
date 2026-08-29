import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { applyDistributionProductName } from '../distribution-product-copy'
import {
  createDistributionTranslationCatalogPlugin,
  type DistributionTranslationCatalogPlugin
} from './distribution-translation-catalog-plugin'

const LOCALES_DIRECTORY = resolve('src/renderer/src/i18n/locales')

function transform(
  plugin: DistributionTranslationCatalogPlugin,
  source: string,
  id: string
): string | null {
  return plugin.transform(source, id)
}

describe('distribution translation catalog plugin', () => {
  it('uses Horca in every built-in translation without changing source files', () => {
    const plugin = createDistributionTranslationCatalogPlugin('horca')
    const localeFiles = readdirSync(LOCALES_DIRECTORY).filter((file) => file.endsWith('.json'))

    expect(localeFiles).toHaveLength(5)
    for (const file of localeFiles) {
      const source = readFileSync(join(LOCALES_DIRECTORY, file), 'utf8')
      const transformed = transform(plugin, source, join(LOCALES_DIRECTORY, file))

      expect(transformed).not.toBeNull()
      expect(transformed).not.toMatch(/\bOrca\b/)
      expect(source).toMatch(/\bOrca\b/)
    }
  })

  it('keeps official catalogs and non-catalog JSON unchanged', () => {
    const source = '{"title":"Open Orca"}'

    expect(
      transform(
        createDistributionTranslationCatalogPlugin('official'),
        source,
        '/repo/src/renderer/src/i18n/locales/en.json'
      )
    ).toBeNull()
    expect(
      transform(
        createDistributionTranslationCatalogPlugin('horca'),
        source,
        '/repo/src/renderer/src/data.json'
      )
    ).toBeNull()
  })

  it('preserves interpolation and names that only contain Orca', () => {
    const source = JSON.stringify({
      title: '{{value0}} in Orca',
      website: 'https://onOrca.dev'
    })
    const transformed = transform(
      createDistributionTranslationCatalogPlugin('horca'),
      source,
      'C:\\repo\\src\\renderer\\src\\i18n\\locales\\en.json'
    )

    expect(JSON.parse(transformed as string)).toEqual({
      title: '{{value0}} in Horca',
      website: 'https://onOrca.dev'
    })
    expect(applyDistributionProductName("Use Orca's browser", 'Horca')).toBe("Use Horca's browser")
  })
})
