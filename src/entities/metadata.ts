import { Value } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'


class Metadata {
  imageUrl: string
  displayName: string
  description: string
}

export function updateMetadata(metadata: Metadata, vaultAddress: Value): void {
  const vault = Vault.load(vaultAddress.toString())

  if (vault) {
    if (metadata.description) {
      const isDescriptionValid = metadata.description.length <= 1000

      vault.description = isDescriptionValid ? metadata.description : ''
    }

    if (metadata.displayName) {
      const isDisplayNameValid = metadata.displayName.length <= 30

      vault.displayName = isDisplayNameValid ? metadata.displayName : ''
    }

    if (metadata.imageUrl) {
      const isImageUrlValid = metadata.imageUrl.startsWith('https://static.stakewise.io/')

      vault.imageUrl = isImageUrlValid ? metadata.imageUrl : ''
    }

    vault.save()
  }
}
