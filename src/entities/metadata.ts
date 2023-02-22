import {JSONValue, JSONValueKind} from '@graphprotocol/graph-ts'

import { Debug, Vault } from '../../generated/schema'


export function updateMetadata(metadata: JSONValue, vault: Vault, debug: Debug): void {
  if (metadata.kind !== JSONValueKind.OBJECT) return
  const json = metadata.toObject()

  const imageUrl = json.get('image_url')
  const displayName = json.get('display_name')
  const description = json.get('description')

  if (description && description.kind === JSONValueKind.STRING) {
    const descriptionString = description.toString()
    const isDescriptionValid = descriptionString.length <= 1000

    debug.description = isDescriptionValid ? descriptionString : ''
    vault.description = isDescriptionValid ? descriptionString : ''
  }
  else {
    debug.description = 'NONE'
  }

  if (displayName && displayName.kind === JSONValueKind.STRING) {
    const displayNameString = displayName.toString()
    const isDisplayNameValid = displayNameString.length <= 30

    debug.displayName = isDisplayNameValid ? displayNameString : ''
    vault.displayName = isDisplayNameValid ? displayNameString : ''
  }
  else {
    debug.displayName = 'NONE'
  }

  if (imageUrl && imageUrl.kind === JSONValueKind.STRING) {
    const imageUrlString = imageUrl.toString()
    const isImageUrlValid = imageUrlString.startsWith('https://storage.stakewise.io/')

    debug.imageUrl = isImageUrlValid ? imageUrlString : ''
    vault.imageUrl = isImageUrlValid ? imageUrlString : ''
  }
  else {
    debug.imageUrl = 'NONE'
  }
}
