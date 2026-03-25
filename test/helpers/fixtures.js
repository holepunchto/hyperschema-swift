'use strict'

// Loads test fixtures from hyperschema-fixtures and filters to types
// supported by the current Swift codegen (uint only).
//
// Each fixture:
//   name      - human-readable description
//   register  - function that registers types into any Hyperschema instance
//   cases     - test cases, each with:
//     type    - fully-qualified type name (e.g. '@ns27/counter')
//     value   - canonical JS value for encode/decode
//     encoded - canonical hex-encoded bytes
//     swift   - Swift-specific info:
//       codec      - Swift codec variable name
//       encode     - Swift expression that constructs the value
//       assertions - Swift precondition lines run after decoding

const path = require('path')

const FIXTURES_DIR = path.resolve(require.resolve('hyperschema-test'), '../fixtures')

const SUPPORTED_TYPES = new Set(['uint'])

function toSwiftTypeName(name) {
  return name
    .split('-')
    .map((s) => (s.length ? s[0].toUpperCase() + s.slice(1) : s))
    .join('')
}

function toSwiftInstanceName(name) {
  const pascal = toSwiftTypeName(name)
  return pascal[0].toLowerCase() + pascal.slice(1)
}

function toSwiftLiteral(value, type) {
  if (type === 'uint') return String(value)
  throw new Error(`Unsupported type for Swift literal: ${type}`)
}

function fixtureSupported(schema) {
  return schema.schema.every(
    (struct) => struct.fields && struct.fields.every((f) => SUPPORTED_TYPES.has(f.type))
  )
}

function makeRegister(schema) {
  return function register(hyperschema) {
    for (const struct of schema.schema) {
      const ns = hyperschema.namespace(struct.namespace)
      ns.register({
        name: struct.name,
        compact: struct.compact || false,
        fields: struct.fields.map((f) => ({
          name: f.name,
          type: f.type,
          required: f.required || false
        }))
      })
    }
  }
}

// Collect all fixture IDs from index
const index = require(path.join(FIXTURES_DIR, 'index.json'))
const allIds = new Set()
for (const category of Object.values(index)) {
  for (const ids of Object.values(category)) {
    for (const id of ids) allIds.add(id)
  }
}

const fixtures = []

for (const id of [...allIds].sort((a, b) => Number(a) - Number(b))) {
  const fixtureDir = path.join(FIXTURES_DIR, id)
  const schema = require(path.join(fixtureDir, 'schema.json'))
  const testData = require(path.join(fixtureDir, 'test.json'))

  if (!fixtureSupported(schema)) continue

  const cases = []
  for (let i = 0; i < testData.values.length; i++) {
    const value = testData.values[i]
    const encoded = testData.encoded[i]
    const struct = schema.schema[0]

    const typeName = toSwiftTypeName(struct.name)
    const instanceName = toSwiftInstanceName(struct.name)

    const args = struct.fields
      .map((f) => `${f.name}: ${toSwiftLiteral(value[f.name], f.type)}`)
      .join(', ')

    const assertions = struct.fields.map(
      (f) =>
        `precondition(decoded.${f.name} == ${toSwiftLiteral(value[f.name], f.type)}, "field ${f.name}: expected ${value[f.name]}, got \\(decoded.${f.name})")`
    )

    cases.push({
      type: `@${struct.namespace}/${struct.name}`,
      value,
      encoded,
      swift: {
        codec: instanceName,
        encode: `${typeName}(${args})`,
        assertions
      }
    })
  }

  fixtures.push({
    name: `fixture ${id}: ${schema.schema.map((s) => s.name).join(', ')}`,
    register: makeRegister(schema),
    cases
  })
}

module.exports = fixtures
