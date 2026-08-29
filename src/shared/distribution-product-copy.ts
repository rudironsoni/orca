import { getDistributionIdentity } from './distribution-identity'

export function applyDistributionProductName(
  value: string,
  productName = getDistributionIdentity().productName
): string {
  return replaceProductName(value, productName)
}

export function applyDistributionProductNameToCatalog(
  catalog: Record<string, unknown>,
  productName = getDistributionIdentity().productName
): Record<string, unknown> {
  return productName === 'Orca'
    ? catalog
    : (mapCatalogValue(catalog, productName) as Record<string, unknown>)
}

function replaceProductName(value: string, productName: string): string {
  return productName === 'Orca' ? value : value.replaceAll(/\bOrca\b/g, productName)
}

function mapCatalogValue(value: unknown, productName: string): unknown {
  if (typeof value === 'string') {
    return replaceProductName(value, productName)
  }
  if (Array.isArray(value)) {
    return value.map((child) => mapCatalogValue(child, productName))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        mapCatalogValue(child, productName)
      ])
    )
  }
  return value
}
