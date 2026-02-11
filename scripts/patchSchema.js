const { readFileSync, writeFileSync } = require('fs')
const path = require('path')

const schemaPath = path.join(__dirname, '..', 'generated', 'schema.ts')
let content = readFileSync(schemaPath, 'utf8')

const target = 'store.set("ExchangeRateSnapshot", id.toI64().toString(), this);'
const replacement = 'return; // no-op: matchstick 0.6.0 lacks Timestamp support'

if (!content.includes(target)) {
  console.log('ExchangeRateSnapshot.save() already patched or not found')
  process.exit(0)
}

content = content.replace(target, replacement)
writeFileSync(schemaPath, content)
console.log('Patched ExchangeRateSnapshot.save() to no-op')
