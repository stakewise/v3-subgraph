# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Graph Protocol subgraph** for StakeWise V3, a liquid staking protocol. The subgraph indexes blockchain events to provide analytics and historical data for the StakeWise ecosystem across multiple networks (Ethereum mainnet, Gnosis, Hoodi testnet).

## Build Commands

```bash
# Install dependencies
npm install

# Build for a specific network (generates types and compiles to WASM)
npm run build:mainnet
npm run build:gnosis
npm run build:hoodi

# Run tests for a specific network
npm run test:mainnet
npm run test:gnosis

# Deploy to staging/production
IPFS_URL=<ipfs-node> GRAPH_URL=<graph-node> npm run deploy-stage:mainnet
IPFS_URL=<ipfs-node> GRAPH_URL=<graph-node> npm run deploy-prod:mainnet
```

## Code Architecture

### Network Configuration System

The subgraph uses a template-based system for multi-network support:

1. **Config files** (`src/config/{network}.json`) - Contains network-specific contract addresses and start blocks
2. **Template YAML** (`src/subgraph.template.yaml`) - Mustache template for the subgraph manifest
3. **Constants generation** (`scripts/createConstants.js`) - Generates `src/helpers/constants.ts` from config JSON

When you run `npm run prepare:{network}`, it:

- Generates constants from the network config
- Creates the network-specific subgraph YAML via mustache templating
- Runs `graph codegen` to generate TypeScript types from ABIs and schema

### Directory Structure

- `src/mappings/` - Event handlers that process blockchain events (the main indexing logic)
- `src/entities/` - Entity creation and update functions (business logic for GraphQL types)
- `src/helpers/` - Utility functions and generated constants
- `src/abis/` - Contract ABIs for type generation
- `src/config/` - Network-specific configuration JSON files
- `tests/` - Unit tests using matchstick-as framework

### Key Entity Relationships

- **Vault** - Central entity representing staking vaults with various types (private, ERC20, blocklist, meta)
- **Allocator** - Users who stake in vaults; linked to Vault via `<vault-id>-<user-address>` composite ID
- **OsToken** - Liquid staking token (osETH on mainnet, osGNO on Gnosis)
- **ExitRequest** - Tracks withdrawals from vaults with position tickets
- **LeverageStrategyPosition** - Aave-based leverage positions for boosted staking

### Mapping Pattern

Event handlers in `src/mappings/` follow this pattern:

1. Load or create entities using functions from `src/entities/`
2. Update entity state based on event parameters
3. Create transaction records and allocator actions for tracking
4. Log the event for debugging

### Data Sources

The subgraph uses both static data sources (deployed contracts) and dynamic templates:

- **Static**: Keeper, OsToken, VaultFactories, MerkleDistributor, etc.
- **Templates**: Vault, RewardSplitter, UniswapPool (created dynamically when new instances deploy)

## Testing

Tests use the [matchstick-as](https://thegraph.com/docs/en/developing/unit-testing-framework/) framework:

```bash
# Run all tests for a network
npm run test:mainnet

# Tests are in tests/*.test.ts
```

## Important Patterns

### Multicall for Batch Reads

The codebase uses `chunkedMulticall` from `src/helpers/utils.ts` to batch multiple contract reads efficiently. This is critical for syncing vault state.

### APY Calculations

APY calculations use 7-day rolling snapshots stored in `VaultSnapshot` and `AllocatorSnapshot` entities. The `calculateApy` function in utils handles the math.

### Version-Aware Logic

Many functions check `vault.version` to handle different contract versions (V1, V2, V3, V5) which have different interfaces, especially around exit queue handling.

## Git Conventions

Use short commit messages only (no description or co-author).
