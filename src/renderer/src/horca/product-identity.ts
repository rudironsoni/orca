import { getDistributionIdentity } from '../../../shared/distribution-identity'
import { applyDistributionProductName } from '../../../shared/distribution-product-copy'

export const ACTIVE_PRODUCT_NAME = getDistributionIdentity().productName

export function productCopy(template: string): string {
  return applyDistributionProductName(template)
}
