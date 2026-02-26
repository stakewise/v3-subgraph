const { readFileSync, writeFileSync, copyFileSync, existsSync } = require('fs')
const path = require('path')

const schemaPath = path.join(__dirname, '..', 'generated', 'schema.ts')
const backupPath = schemaPath + '.bak'

let content = readFileSync(schemaPath, 'utf8')

const targetRegex = /store\.set\(\s*"ExchangeRateSnapshot"\s*,\s*id\.toI64\(\)\.toString\(\)\s*,\s*this\s*\);/g
const replacement = 'return; // no-op: matchstick 0.6.0 lacks Timestamp support'

const matches = content.match(targetRegex)
if (!matches || matches.length === 0) {
  console.log('ExchangeRateSnapshot.save() already patched or not found')
  process.exit(0)
}
if (matches.length > 1) {
  console.error('Multiple ExchangeRateSnapshot.save() store.set occurrences found; refusing to patch')
  process.exit(1)
}

if (!existsSync(backupPath)) {
  copyFileSync(schemaPath, backupPath)
  console.log('Backed up schema.ts → schema.ts.bak')
}

content = content.replace(targetRegex, replacement)
writeFileSync(schemaPath, content)
console.log('Patched ExchangeRateSnapshot.save() to no-op')
