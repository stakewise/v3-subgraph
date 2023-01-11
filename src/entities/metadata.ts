import {JSONValue, JSONValueKind} from '@graphprotocol/graph-ts'

import {Vault} from '../../generated/schema'


export function updateMetadata(metadata: JSONValue, vault: Vault): void {
  if (metadata.kind != JSONValueKind.OBJECT) return
  const json = metadata.toObject()

  const imageUrl = json.get('imageUrl')
  const displayName = json.get('displayName')
  const description = json.get('description')

  if (description && description.kind == JSONValueKind.STRING) {
    const descriptionString = description.toString()
    const isDescriptionValid = descriptionString.length <= 1000

    vault.description = isDescriptionValid ? descriptionString : ''
  }

  if (displayName && displayName.kind == JSONValueKind.STRING) {
    const displayNameString = displayName.toString()
    const isDisplayNameValid = displayNameString.length <= 30

    vault.displayName = isDisplayNameValid ? displayNameString : ''
  }

  if (imageUrl && imageUrl.kind == JSONValueKind.STRING) {
    const imageUrlString = imageUrl.toString()
    const isImageUrlValid = imageUrlString.startsWith('https://static.stakewise.io/')

    vault.imageUrl = isImageUrlValid ? imageUrlString : ''
  }
}
