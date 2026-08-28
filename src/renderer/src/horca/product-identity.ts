import { getDistributionIdentity } from '../../../shared/distribution-identity'

export const ACTIVE_PRODUCT_NAME = getDistributionIdentity().productName

export function productCopy(template: string): string {
  return template.replaceAll('Orca', ACTIVE_PRODUCT_NAME)
}
