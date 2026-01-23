const path = require('path')
const { execAsync } = require('./util')

require('dotenv').config()

const IPFS_URL = process.env.IPFS_URL
const GRAPH_URL = process.env.GRAPH_URL

const args = process.argv.reduce((acc, arg) => {
  if (/:/.test(arg)) {
    const [key, value] = arg.split(':')

    acc[key] = value
  }

  return acc
}, {})

const validateEnv = () => {
  if (!GRAPH_URL) {
    throw new Error('GRAPH_URL is required env variable')
  }
  if (!IPFS_URL) {
    throw new Error('IPFS_URL is required env variable')
  }
}

const validateArgs = () => {
  const { network, env } = args

  const allowedNetworks = ['hoodi', 'mainnet', 'gnosis']
  const allowedEnvs = ['prod', 'stage']

  if (!network) {
    throw new Error('Argument "network" is required')
  }
  if (!env) {
    throw new Error('Argument "env" is required')
  }
  if (!allowedNetworks.includes(network)) {
    throw new Error(`Argument "network" must include one of: ${allowedNetworks.join(', ')}`)
  }
  if (!allowedEnvs.includes(env)) {
    throw new Error(`Argument "env" must include one of: ${allowedEnvs.join(', ')}`)
  }
}

const deploy = async () => {
  const { network, env } = args

  const srcDirectory = path.resolve(__dirname, `../src`)

  const { version } = require('../package.json')
  const createCommand = `graph create --node ${GRAPH_URL} stakewise/${env}`
  const deployCommand = `graph deploy --version-label ${version} --node ${GRAPH_URL} --ipfs ${IPFS_URL} stakewise/${env}`

  const command = [
    createCommand,
    `cd ${srcDirectory}`,
    `cp subgraph-${network}.yaml subgraph.yaml`,
    deployCommand,
    'rm subgraph.yaml',
  ].join(' && ')

  await execAsync(command)
}

validateArgs()
validateEnv()
deploy()
