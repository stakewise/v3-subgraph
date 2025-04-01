const { readFile, writeFileSync, existsSync, mkdirSync } = require('fs')
const path = require('path')

const isMainnet = process.argv.includes('mainnet')
const isHoodi = process.argv.includes('hoodi')
const isChiado = process.argv.includes('chiado')
const isGnosis = process.argv.includes('gnosis') || process.argv.includes('xdai')

let configName = null

if (isMainnet) {
  configName = 'mainnet'
}

if (isHoodi) {
  configName = 'hoodi'
}

if (isChiado) {
  configName = 'chiado'
}

if (isGnosis) {
  configName = 'gnosis'
}

if (!configName) {
  throw new Error('Network is not supported')
}

const zeroAddress = '0x0000000000000000000000000000000000000000'
const helpersFolderPath = path.resolve(__dirname, '..', 'src', 'helpers')
const resultPath = path.resolve(__dirname, '..', 'src', 'helpers', `constants.ts`)
const configPath = path.resolve(__dirname, '..', 'src', 'config', `${configName}.json`)

let result = `import { Address, BigInt } from '@graphprotocol/graph-ts'\n\n`

result += `\nexport const DAY = BigInt.fromI32(24 * 60 * 60)\n`

const camelToSnakeCase = (inputString) => inputString.replace(/([A-Z])/g, '_$1').toUpperCase()

const createAddressConst = (name, address) =>
  `\nexport const ${name} = Address.fromString('${address || zeroAddress}')\n`

const createStringConst = (name, data) => `\nexport const ${name} = '${data}'\n`
const createArrayConst = (name, data) => `\nexport const ${name}: string[] = [${data.map((item) => "\"" + item + "\"").join(', ')}]\n`

readFile(configPath, 'utf8', (error, data) => {
  if (error) {
    throw new Error(error)
  }

  const parsedData = JSON.parse(data)

  Object.keys(parsedData).forEach((key) => {
    const data = parsedData[key]

    if (typeof data === 'object') {
      if (data.address) {
        const name = camelToSnakeCase(key)

        result += createAddressConst(name, data.address)
      }
      if (data.startBlock) {
        const name = camelToSnakeCase(key + 'StartBlock')

        result += createStringConst(name, data.startBlock)
      }

      if (Array.isArray(data)) {
        const name = camelToSnakeCase(key)
        result += createArrayConst(name, data)
      }

    }

    if (typeof data === 'string') {
      const name = camelToSnakeCase(key)

      result += createStringConst(name, data)
    }
  })

  const isHelpersFolderExist = existsSync(helpersFolderPath)

  if (!isHelpersFolderExist) {
    mkdirSync(helpersFolderPath)
  }

  writeFileSync(resultPath, result)
})
