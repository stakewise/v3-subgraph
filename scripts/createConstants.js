const { readFile, writeFileSync } = require('fs')
const path = require('path')


const isMainnet = process.argv.includes('mainnet')
const isHolesky = process.argv.includes('holesky')

let configName = null

if (isMainnet) {
  configName = 'mainnet'
}

if (isHolesky) {
  configName = 'holesky'
}

if (!configName) {
  throw new Error('Network is not supported')
}

const zeroAddress = '0x0000000000000000000000000000000000000000'
const configPath = path.resolve(__dirname, '..', 'src', 'config', `${configName}.json`)
const resultPath = path.resolve(__dirname, '..', 'src', 'helpers', `${configName}.ts`)

let result = `import { Address } from '@graphprotocol/graph-ts'\n\n`

const camelToSnakeCase = (inputString) => inputString.replace(/([A-Z])/g, '_$1').toUpperCase()

const createAddressConst = (name, address) => `\nexport const ${name} = Address.fromString('${address || zeroAddress}')\n`

const createStringConst = (name, data) => `\nexport const ${name} = '${data}'\n`

readFile(configPath, 'utf8', (error, data) => {
  if (error) {
    throw new Error(error)
  }

  const parsedData = JSON.parse(data)

  Object.keys(parsedData).forEach((key) => {
    const data = parsedData[key]

    if (typeof data === 'object' && data.address) {
      const name = camelToSnakeCase(key)

      result += createAddressConst(name, data.address)
    }

    if (typeof data === 'string') {
      const name = camelToSnakeCase(key)

      result += createStringConst(name, data)
    }
  })

  writeFileSync(resultPath, result, (error) => {
    if (error) {
      throw new Error(error)
    }

    console.log('SUCCESS!')
  });
})
