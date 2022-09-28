const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')


const abis = [
  {
    from: '../v3-core/artifacts/contracts/vaults/EthVault.sol/EthVault.json',
    to: '../src/abis/Vault.json',
  },
  {
    from: '../v3-core/artifacts/contracts/vaults/EthVaultFactory.sol/EthVaultFactory.json',
    to: '../src/abis/VaultFactory.json',
  },
  {
    from: '../v3-core/artifacts/contracts/libraries/ExitQueue.sol/ExitQueue.json',
    to: '../src/abis/ExitQueue.json',
  },
]

const execAsync = (command) => (
  new Promise((resolve, reject) => {
    exec(command, (error, stdout) => {
      if (error) {
        reject(error)
      }
      else {
        resolve(stdout.trim())
      }
    })
  })
)

const generateAbis = async () => {
  console.log('Abis generating started')

  console.log(' - clone v3-core')

  try {
    await execAsync('git clone git@github.com:stakewise/v3-core.git ./v3-core')
  }
  catch (error) {
    if (error?.code === 128) {
      await execAsync('cd ./v3-core && git pull && cd ../')
    }
    else {
      throw new Error(error)
    }
  }

  console.log(' - install node_modules')
  await execAsync('npm ci --prefix ./v3-core')

  console.log(' - compile contracts')
  await execAsync('npm run compile --prefix ./v3-core')

  console.log(' - copy contract abis')
  abis.forEach(({ from, to }) => {
    const fromPath = path.resolve(__dirname, from)
    const toPath = path.resolve(__dirname, to)

    const fromFile = fs.readFileSync(fromPath, 'utf8')
    const fromJSON = JSON.parse(fromFile)
    const toFile = JSON.stringify(fromJSON.abi, null, 2)

    const abiTitle = toPath.replace(/.*\/|\.json/, '')

    fs.writeFileSync(toPath, toFile, 'utf8')
    console.log(` - ${abiTitle} abi copied`)
  })

  console.log('Abis successfully generated')
}


generateAbis()
