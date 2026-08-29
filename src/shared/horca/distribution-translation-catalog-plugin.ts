import { DISTRIBUTION_IDENTITIES, type OrcaDistribution } from '../distribution-identity'
import { applyDistributionProductNameToCatalog } from '../distribution-product-copy'

const TRANSLATION_CATALOG_DIRECTORY = '/src/renderer/src/i18n/locales/'

export type DistributionTranslationCatalogPlugin = {
  name: string
  enforce: 'pre'
  transform: (source: string, id: string) => string | null
}

function isTranslationCatalog(id: string): boolean {
  const normalizedId = id.split('?', 1)[0].replaceAll('\\', '/')
  return normalizedId.includes(TRANSLATION_CATALOG_DIRECTORY) && normalizedId.endsWith('.json')
}

export function createDistributionTranslationCatalogPlugin(
  distribution: OrcaDistribution
): DistributionTranslationCatalogPlugin {
  const productName = DISTRIBUTION_IDENTITIES[distribution].productName

  return {
    name: 'horca-distribution-translation-catalog',
    enforce: 'pre',
    transform(source, id) {
      if (productName === 'Orca' || !isTranslationCatalog(id)) {
        return null
      }
      const catalog = JSON.parse(source) as unknown
      if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
        throw new Error(`Translation catalog must contain an object: ${id}`)
      }
      return JSON.stringify(
        applyDistributionProductNameToCatalog(catalog as Record<string, unknown>, productName)
      )
    }
  }
}
