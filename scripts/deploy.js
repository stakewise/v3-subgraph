const path = require('path')
const { execAsync } = require('./util')

require('dotenv').config()


const args = process.argv.reduce((acc, arg) => {
  if (/:/.test(arg)) {
    const [ key, value ] = arg.split(':')

    acc[key] = value
  }

  return acc
}, {})

const deploy = async () => {
  const GRAPH_TOKEN = process.env.GRAPH_TOKEN

  if (GRAPH_TOKEN) {
    const { network, version } = args

    const srcDirectory = path.resolve(__dirname, `../src`)
    const buildDirectory = path.resolve(__dirname, `../build/${network}`)

    const command = [
      `graph auth --product hosted-service ${GRAPH_TOKEN}`,
      `cd ${srcDirectory}`,
      `cp subgraph-${network}.yaml subgraph.yaml`,
      `graph deploy --product hosted-service mike-diamond/v3-stakewise-goerli --output-dir ${buildDirectory} --access-token ${GRAPH_TOKEN}`,
      'rm subgraph.yaml',
    ]
      .join(' && ')

    await execAsync(command)

  }
  else {
    throw new Error('GRAPH_TOKEN is not exist in env')
  }
}

deploy()
