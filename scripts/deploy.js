const path = require('path')
const { execAsync } = require('./util')

require('dotenv').config()


// LOCAL
const IPFS_URL = process.env.IPFS_URL
const LOCAL_GRAPH_URL = process.env.LOCAL_GRAPH_URL

// HOSTED
const HOSTED_GRAPH_TOKEN = process.env.HOSTED_GRAPH_TOKEN
const HOSTED_SUBGRAPH_URL_GOERLI = process.env.HOSTED_SUBGRAPH_URL_GOERLI

const args = process.argv.reduce((acc, arg) => {
  if (/:/.test(arg)) {
    const [ key, value ] = arg.split(':')

    acc[key] = value
  }

  return acc
}, {})

const validateEnv = () => {
  if (args.node === 'hosted') {
    if (!HOSTED_GRAPH_TOKEN) {
      throw new Error('HOSTED_GRAPH_TOKEN is required env variable for "node:hosted" deployment')
    }
    if (!HOSTED_SUBGRAPH_URL_GOERLI) {
      throw new Error('HOSTED_SUBGRAPH_URL_GOERLI is required env variable for "node:hosted" deployment')
    }
  }
  if (args.node === 'local') {
    if (!LOCAL_GRAPH_URL) {
      throw new Error('LOCAL_GRAPH_URL is required env variable for "node:local" deployment')
    }
    if (!IPFS_URL) {
      throw new Error('IPFS_URL is required env variable for "node:local" deployment')
    }
  }
}

const validateArgs = () => {
  const { network, node } = args

  const allowedNetworks = [ 'goerli' ]
  const allowedNodes = [ 'hosted', 'local' ]

  if (!network) {
    throw new Error('Argument "network" is required')
  }
  if (!node) {
    throw new Error('Argument "node" is required')
  }
  if (!allowedNetworks.includes(network)) {
    throw new Error(`Argument "network" must include one of: ${allowedNetworks.join(', ')}`)
  }
  if (!allowedNodes.includes(node)) {
    throw new Error(`Argument "node" must include one of: ${allowedNodes.join(', ')}`)
  }
}

const deploy = async () => {
  const { network, node } = args

  const srcDirectory = path.resolve(__dirname, `../src`)
  const buildDirectory = path.resolve(__dirname, `../build/${network}`)

  let authCommand = ''
  let deployCommand = ''

  if (node === 'hosted') {
    authCommand = `graph auth --product hosted-service ${HOSTED_GRAPH_TOKEN}`
    deployCommand = `graph deploy --product hosted-service ${HOSTED_SUBGRAPH_URL_GOERLI} --output-dir ${buildDirectory} --access-token ${HOSTED_GRAPH_TOKEN}`
  }
  if (node === 'local') {
    const { version } = require('../package.json')

    authCommand = `graph create --node ${LOCAL_GRAPH_URL} stakewise/stakewise`
    deployCommand = `graph deploy --version-label ${version} --node ${LOCAL_GRAPH_URL} --ipfs ${IPFS_URL} stakewise/stakewise`
  }

  const command = [
    authCommand,
    `cd ${srcDirectory}`,
    `cp subgraph-${network}.yaml subgraph.yaml`,
    deployCommand,
    'rm subgraph.yaml',
  ]
    .join(' && ')

  await execAsync(command)
}

validateArgs()
validateEnv()
deploy()
