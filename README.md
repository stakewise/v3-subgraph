# StakeWise V3 Subgraph

Aims to deliver analytics & historical data for StakeWise.
Still a work in progress. Feel free to contribute!

The Graph exposes a GraphQL endpoint to query the events
and entities within the StakeWise ecosystem.

## Deployment

1.  Install dependencies:

    ```shell script
    npm install
    ```

2.  Build the subgraph to check compile errors
    before deploying:

    ```shell script
    npm run build:mainnet
    ```

3.  Deploy subgraph to your stage environment:

    ```shell script
    IPFS_URL=<your IPFS node> GRAPH_URL=<your graph node> npm run deploy-stage:mainnet
    ```

4.  Deploy subgraph to your prod environment:

    ```shell script
    IPFS_URL=<your IPFS node> GRAPH_URL=<your graph node> npm run deploy-prod:mainnet
    ```

## Documentation

The documentation for all the GraphQL object fields can be
found by going to `src/schema.graphql`.
