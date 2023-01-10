import { JSONValue, Value } from '@graphprotocol/graph-ts'

import { Vault } from '../../generated/schema'


export function updateMetadata(metadata: JSONValue, vaultAddress: Value): void {
  if (metadata) {
    const json = metadata.toObject()
    const vault = Vault.load(vaultAddress.toString())

    const imageUrl = json.get('imageUrl')
    const displayName = json.get('displayName')
    const description = json.get('description')

    if (vault) {
      if (description) {
        const descriptionString = description.toString()
        const isDescriptionValid = descriptionString.length <= 1000

        vault.description = isDescriptionValid ? descriptionString : ''
      }

      if (displayName) {
        const displayNameString = displayName.toString()
        const isDisplayNameValid = displayNameString.length <= 30

        vault.displayName = isDisplayNameValid ? displayNameString : ''
      }

      if (imageUrl) {
        const imageUrlString = imageUrl.toString()
        const isImageUrlValid = imageUrlString.startsWith('https://static.stakewise.io/')

        vault.imageUrl = isImageUrlValid ? imageUrlString : ''
      }

      vault.save()
    }
  }
}
