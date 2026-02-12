const { existsSync, renameSync } = require('fs')
const path = require('path')

const schemaPath = path.join(__dirname, '..', 'generated', 'schema.ts')
const backupPath = schemaPath + '.bak'

if (existsSync(backupPath)) {
  renameSync(backupPath, schemaPath)
  console.log('Restored schema.ts from backup')
} else {
  console.log('No schema.ts.bak found, nothing to restore')
}
