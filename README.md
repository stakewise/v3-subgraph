# StakeWise V3 Subgraph

Aims to deliver analytics & historical data for StakeWise.
Still a work in progress. Feel free to contribute!

The Graph exposes a GraphQL endpoint to query the events
and entities within the StakeWise ecosystem.

## Deployment

1. Install dependencies:

   ```shell script
   npm install
   ```

2. Prepare subgraphs for the network you want to deploy on
(currently supports only goerli):

   ```shell script
   npm run prepare:goerli
   ```

3. Optionally, build the subgraph to check compile errors
before deploying:

    ```shell script
    npm run build:goerli
    ```

4. Authenticate to the Graph API for deployment:
    ```shell script
    npm run graph auth 
    ```

5. Deploy the subgraph (WIP)

## Documentation

The documentation for all the GraphQL object fields can be
found by going to `src/schema.graphql`.
