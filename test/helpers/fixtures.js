'use strict'

// Loads test fixtures from hyperschema-fixtures and filters to types
// supported by the current Swift codegen.
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

const SUPPORTED_TYPES = new Set(['uint', 'bool', 'string', 'buffer'])

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

// Resolves a single level of alias (e.g. @ns6/score -> uint).
// Does not recurse through chained aliases; sufficient for current fixtures.
function resolveAliasType(schema, typeName) {
  if (!typeName.startsWith('@')) return typeName
  const parts = typeName.slice(1).split('/')
  const ns = parts[0]
  const name = parts[1]
  const entry = schema.schema.find((s) => s.namespace === ns && s.name === name)
  if (entry && entry.alias) return entry.alias
  return typeName
}

function toSwiftLiteral(value, type) {
  if (type === 'uint') return String(value)
  if (type === 'bool') return value ? 'true' : 'false'
  if (type === 'string') return JSON.stringify(value)
  if (type === 'buffer') {
    const bytes = value.data || []
    if (bytes.length === 0) return 'Data()'
    return `Data([${bytes.join(', ')}])`
  }
  throw new Error(`Unsupported type for Swift literal: ${type}`)
}

function getSwiftTypeName(type) {
  if (type === 'uint') return 'UInt'
  if (type === 'bool') return 'Bool'
  if (type === 'string') return 'String'
  if (type === 'buffer') return 'Data'
  throw new Error(`Unsupported type: ${type}`)
}

function toSwiftArrayLiteral(values, elementType) {
  if (values.length === 0) return `[${getSwiftTypeName(elementType)}]()`
  const items = values.map((v) => toSwiftLiteral(v, elementType))
  return `[${items.join(', ')}] as [${getSwiftTypeName(elementType)}]`
}

function toSwiftMessageLiteral(value, type) {
  if (type === 'string') return JSON.stringify(value).slice(1, -1)
  if (type === 'buffer') {
    const bytes = value.data || []
    return `[${bytes.join(', ')}]`
  }
  return String(value)
}

function fixtureSupported(schema) {
  return schema.schema.every((entry) => {
    if (entry.alias) return SUPPORTED_TYPES.has(entry.alias)
    if (entry.array) {
      const elemType = resolveAliasType(schema, entry.type)
      return SUPPORTED_TYPES.has(elemType)
    }
    if (entry.fields) {
      return entry.fields.every((f) => SUPPORTED_TYPES.has(f.type) && f.required)
    }
    return false
  })
}

function makeRegister(schema) {
  return function register(hyperschema) {
    const namespaces = new Map()
    for (const entry of schema.schema) {
      if (!namespaces.has(entry.namespace)) {
        namespaces.set(entry.namespace, hyperschema.namespace(entry.namespace))
      }
      const ns = namespaces.get(entry.namespace)
      if (entry.alias) {
        ns.register({ name: entry.name, alias: entry.alias })
      } else if (entry.array) {
        ns.register({ name: entry.name, array: true, type: entry.type })
      } else {
        ns.register({
          name: entry.name,
          compact: entry.compact || false,
          fields: entry.fields.map((f) => ({
            name: f.name,
            type: f.type,
            required: f.required || false
          }))
        })
      }
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

  // Find the primary type to test (last entry — arrays reference aliases defined before them)
  const primary = schema.schema[schema.schema.length - 1]

  for (let i = 0; i < testData.values.length; i++) {
    const value = testData.values[i]
    const encoded = testData.encoded[i]

    if (primary.array) {
      const instanceName = toSwiftInstanceName(primary.name)
      const elemType = resolveAliasType(schema, primary.type)
      const literal = toSwiftArrayLiteral(value, elemType)

      const assertions = [
        `precondition(decoded.count == ${value.length}, "expected count ${value.length}, got \\(decoded.count)")`
      ]
      for (let j = 0; j < value.length; j++) {
        assertions.push(
          `precondition(decoded[${j}] == ${toSwiftLiteral(value[j], elemType)}, "element ${j}: expected ${toSwiftMessageLiteral(value[j], elemType)}, got \\(decoded[${j}])")`
        )
      }

      cases.push({
        type: `@${primary.namespace}/${primary.name}`,
        value,
        encoded,
        swift: {
          codec: instanceName,
          encode: literal,
          assertions
        }
      })
    } else if (primary.fields) {
      const typeName = toSwiftTypeName(primary.name)
      const instanceName = toSwiftInstanceName(primary.name)

      const args = primary.fields
        .map((f) => `${f.name}: ${toSwiftLiteral(value[f.name], f.type)}`)
        .join(', ')

      const assertions = primary.fields.map(
        (f) =>
          `precondition(decoded.${f.name} == ${toSwiftLiteral(value[f.name], f.type)}, "field ${f.name}: expected ${toSwiftMessageLiteral(value[f.name], f.type)}, got \\(decoded.${f.name})")`
      )

      cases.push({
        type: `@${primary.namespace}/${primary.name}`,
        value,
        encoded,
        swift: {
          codec: instanceName,
          encode: `${typeName}(${args})`,
          assertions
        }
      })
    }
  }

  fixtures.push({
    name: `fixture ${id}: ${schema.schema.map((s) => s.name).join(', ')}`,
    register: makeRegister(schema),
    cases
  })
}

module.exports = fixtures
