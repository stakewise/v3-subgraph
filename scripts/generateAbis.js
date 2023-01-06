const fs = require('fs')
const path = require('path')

const { execAsync } = require('./util')


const abis = [
  {
    from: '../v3-core/abi/IEthVault.json',
    to: '../src/abis/Vault.json',
  },
  {
    from: '../v3-core/abi/IEthVaultFactory.json',
    to: '../src/abis/VaultFactory.json',
  },
  {
    from: '../v3-core/abi/ExitQueue.json',
    to: '../src/abis/ExitQueue.json',
  },
]

const generateAbis = async () => {
  console.log('Abis generating started')

  console.log(' - clone v3-core')

  try {
    await execAsync('git clone git@github.com:stakewise/v3-core.git ./v3-core')
  }
  catch (error) {
    const isDirectoryExist = error?.code === 128

    if (isDirectoryExist) {
      await execAsync('cd ./v3-core && git pull && cd ../')
    }
    else {
      throw new Error(error)
    }
  }

  console.log(' - copy contract abis')
  abis.forEach(({ from, to }) => {
    const fromPath = path.resolve(__dirname, from)
    const toPath = path.resolve(__dirname, to)

    const fromFile = fs.readFileSync(fromPath, 'utf8')
    const fromJSON = JSON.parse(fromFile)
    const toFile = JSON.stringify(fromJSON, null, 2)

    const abiTitle = toPath.replace(/.*\/|\.json/, '')

    fs.writeFileSync(toPath, toFile, 'utf8')
    console.log(` - ${abiTitle} abi copied`)
  })

  console.log('Abis successfully generated')
}


generateAbis()
