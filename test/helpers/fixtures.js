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

const SUPPORTED_PRIMITIVE_TYPES = new Set(['uint', 'bool', 'string', 'buffer'])

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

function resolveStructEntry(schema, typeName) {
  const resolved = resolveAliasType(schema, typeName)
  const fqn = resolved.startsWith('@') ? resolved : typeName
  if (!fqn.startsWith('@')) return null
  const parts = fqn.slice(1).split('/')
  return schema.schema.find((s) => s.namespace === parts[0] && s.name === parts[1] && s.fields)
}

function toSwiftLiteral(value, type, schema) {
  if (type === 'uint') return String(value)
  if (type === 'bool') return value ? 'true' : 'false'
  if (type === 'string') return JSON.stringify(value)
  if (type === 'buffer') {
    const bytes = value.data || []
    if (bytes.length === 0) return 'Data()'
    return `Data([${bytes.join(', ')}])`
  }
  if (schema && type.startsWith('@')) {
    const entry = resolveStructEntry(schema, type)
    if (entry) {
      const typeName = toSwiftTypeName(entry.name)
      const args = entry.fields
        .map((f) => {
          if (f.array) return `${f.name}: ${toSwiftArrayLiteral(value[f.name], f.type, schema)}`
          return `${f.name}: ${toSwiftLiteral(value[f.name], f.type, schema)}`
        })
        .join(', ')
      return `${typeName}(${args})`
    }
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

function toSwiftArrayLiteral(values, elementType, schema) {
  const typeName = SUPPORTED_PRIMITIVE_TYPES.has(elementType)
    ? getSwiftTypeName(elementType)
    : toSwiftTypeName(resolveStructEntry(schema, elementType).name)
  if (values.length === 0) return `[${typeName}]()`
  const items = values.map((v) => toSwiftLiteral(v, elementType, schema))
  return `[${items.join(', ')}] as [${typeName}]`
}

function toSwiftMessageLiteral(value, type) {
  if (type === 'string') return JSON.stringify(value).slice(1, -1)
  if (type === 'buffer') {
    const bytes = value.data || []
    return `[${bytes.join(', ')}]`
  }
  if (typeof value === 'object' && value !== null) return JSON.stringify(value)
  return String(value)
}

// Generate assertion lines for a decoded value, recursing into struct fields
function generateAssertions(path, value, type, schema) {
  const resolved = resolveAliasType(schema, type)
  const entry = resolveStructEntry(schema, type)
  if (entry) {
    const assertions = []
    for (const f of entry.fields) {
      if (f.array) {
        const elemType = resolveAliasType(schema, f.type)
        assertions.push(
          `precondition(${path}.${f.name}.count == ${value[f.name].length}, "${path}.${f.name} count: expected ${value[f.name].length}, got \\(${path}.${f.name}.count)")`
        )
        for (let j = 0; j < value[f.name].length; j++) {
          assertions.push(
            ...generateAssertions(`${path}.${f.name}[${j}]`, value[f.name][j], elemType, schema)
          )
        }
      } else {
        assertions.push(...generateAssertions(`${path}.${f.name}`, value[f.name], f.type, schema))
      }
    }
    return assertions
  }
  const actualType = SUPPORTED_PRIMITIVE_TYPES.has(resolved) ? resolved : type
  return [
    `precondition(${path} == ${toSwiftLiteral(value, actualType, schema)}, "${path}: expected ${toSwiftMessageLiteral(value, actualType)}, got \\(${path})")`
  ]
}

function fixtureSupported(schema) {
  // Build a map of struct FQNs defined in this schema
  const structsByFqn = new Map()
  for (const entry of schema.schema) {
    if (entry.fields) structsByFqn.set(`@${entry.namespace}/${entry.name}`, entry)
  }

  function isTypeSupported(typeName) {
    if (SUPPORTED_PRIMITIVE_TYPES.has(typeName)) return true
    const resolved = resolveAliasType(schema, typeName)
    if (SUPPORTED_PRIMITIVE_TYPES.has(resolved)) return true
    const structEntry = structsByFqn.get(typeName) || structsByFqn.get(resolved)
    if (structEntry) return isStructSupported(structEntry)
    return false
  }

  function isStructSupported(entry) {
    return entry.fields.every((f) => isTypeSupported(f.type) && f.required)
  }

  return schema.schema.every((entry) => {
    if (entry.alias) return isTypeSupported(entry.alias)
    if (entry.array) return isTypeSupported(entry.type)
    if (entry.fields) return isStructSupported(entry)
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
            required: f.required || false,
            array: f.array || false
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
      const literal = toSwiftArrayLiteral(value, elemType, schema)

      const assertions = [
        `precondition(decoded.count == ${value.length}, "expected count ${value.length}, got \\(decoded.count)")`
      ]
      for (let j = 0; j < value.length; j++) {
        assertions.push(...generateAssertions(`decoded[${j}]`, value[j], elemType, schema))
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
        .map((f) => {
          if (f.array) return `${f.name}: ${toSwiftArrayLiteral(value[f.name], f.type, schema)}`
          return `${f.name}: ${toSwiftLiteral(value[f.name], f.type, schema)}`
        })
        .join(', ')

      const assertions = []
      for (const f of primary.fields) {
        if (f.array) {
          const elemType = resolveAliasType(schema, f.type)
          assertions.push(
            `precondition(decoded.${f.name}.count == ${value[f.name].length}, "${f.name} count: expected ${value[f.name].length}, got \\(decoded.${f.name}.count)")`
          )
          for (let j = 0; j < value[f.name].length; j++) {
            assertions.push(
              ...generateAssertions(`decoded.${f.name}[${j}]`, value[f.name][j], elemType, schema)
            )
          }
        } else {
          assertions.push(...generateAssertions(`decoded.${f.name}`, value[f.name], f.type, schema))
        }
      }

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
