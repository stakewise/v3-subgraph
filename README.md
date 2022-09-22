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

   Optionally, to run tests postgresql should be installed:
   ```shell script
   brew install postgresql
   ```

2. Prepare subgraph for the network you want to deploy on
(currently supports only goerli):

   ```shell script
   npm run prepare:goerli
   ```

3. Optionally, build the subgraph to check compile errors
before deploying:

    ```shell script
    npm run build:goerli
    ```

4. Optionally, test the subgraph:

   ```shell script
   npm run test:goerli
   ```

## Documentation

The documentation for all the GraphQL object fields can be
found by going to `src/schema.graphql`.
