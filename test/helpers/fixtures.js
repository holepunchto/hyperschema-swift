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

const SUPPORTED_PRIMITIVE_TYPES = new Set([
  'uint',
  'uint8',
  'uint16',
  'uint32',
  'int',
  'float32',
  'float64',
  'bool',
  'string',
  'buffer'
])

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

// JS hyperschema treats falsy values (0, "", empty buffer) as absent for optional
// fields — the same encoding as null. Normalize so assertions and encode expressions
// match what the canonical bytes actually decode to.
// JS hyperschema treats falsy primitives (0, "") as absent for optional fields,
// the same as null. Buffer objects (even empty ones) are truthy in JS and remain present.
function normOptional(value, type, schema) {
  if (value === null) return null
  if (type === 'bool') return value
  const resolved = schema ? resolveAliasType(schema, type) : type
  if (resolved === 'string') return value === '' ? null : value
  if (typeof value === 'number') return value === 0 ? null : value
  return value
}

function toSwiftLiteral(value, type, schema) {
  if (value === null) return type === 'bool' ? 'false' : 'nil'
  if (type === 'uint') return String(value)
  if (type === 'uint8') return String(value)
  if (type === 'uint16') return String(value)
  if (type === 'uint32') return String(value)
  if (type === 'int') return String(value)
  if (type === 'float32') return String(value)
  if (type === 'float64') return String(value)
  if (type === 'bool') return value ? 'true' : 'false'
  if (type === 'string') return JSON.stringify(value)
  if (type === 'buffer') {
    const bytes = value.data || []
    if (bytes.length === 0) return 'Data()'
    return `Data([${bytes.join(', ')}])`
  }
  if (schema && type.startsWith('@')) {
    const enumEntry = resolveEnumEntry(schema, type)
    if (enumEntry) {
      const offset = enumEntry.offset || 0
      let key
      if (enumEntry.strings) {
        key = value // value is the key string
      } else {
        key = enumEntry.enum[value - offset].key // value is the ordinal
      }
      return `.${key}`
    }
    const entry = resolveStructEntry(schema, type)
    if (entry) {
      const typeName = toSwiftTypeName(entry.name)
      const args = entry.fields
        .map((f) => {
          const v = f.required ? value[f.name] : normOptional(value[f.name], f.type, schema)
          if (f.array) return `${f.name}: ${toSwiftArrayLiteral(v, f.type, schema)}`
          return `${f.name}: ${toSwiftLiteral(v, f.type, schema)}`
        })
        .join(', ')
      return `${typeName}(${args})`
    }
    const resolved = resolveAliasType(schema, type)
    if (resolved !== type) return toSwiftLiteral(value, resolved, schema)
  }
  throw new Error(`Unsupported type for Swift literal: ${type}`)
}

function getSwiftTypeName(type) {
  if (type === 'uint') return 'UInt'
  if (type === 'uint8') return 'UInt8'
  if (type === 'uint16') return 'UInt16'
  if (type === 'uint32') return 'UInt32'
  if (type === 'int') return 'Int'
  if (type === 'float32') return 'Float'
  if (type === 'float64') return 'Double'
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
  if (value === null) return type === 'bool' ? 'false' : 'nil'
  if (type === 'string') return JSON.stringify(value).slice(1, -1)
  if (type === 'buffer') {
    const bytes = value.data || []
    return `[${bytes.join(', ')}]`
  }
  if (typeof value === 'object' && value !== null) return JSON.stringify(value)
  return String(value)
}

// Generate assertion lines for a decoded value, recursing into struct fields
// Escape a path for embedding inside a Swift string literal (not inside \(...)).
function swiftStringEscape(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function generateAssertions(path, value, type, schema, isOptional = false) {
  const resolved = resolveAliasType(schema, type)
  const msgPath = swiftStringEscape(path)
  // Enum types: assert with .caseName literal
  if (schema && resolveEnumEntry(schema, type)) {
    const literal = toSwiftLiteral(value, type, schema)
    return [
      `precondition(${path} == ${literal}, "${msgPath}: expected ${literal}, got \\(${path})")`
    ]
  }
  const entry = resolveStructEntry(schema, type)
  if (entry) {
    if (value === null) {
      return [`precondition(${path} == nil, "${msgPath}: expected nil")`]
    }
    const assertions = []
    if (isOptional) {
      assertions.push(`precondition(${path} != nil, "${msgPath}: expected non-nil")`)
    }
    const accessPath = isOptional ? `${path}!` : path
    for (const f of entry.fields) {
      const fv = f.required ? value[f.name] : normOptional(value[f.name], f.type, schema)
      const isFieldOptional = !f.required
      if (f.array) {
        const elemType = resolveAliasType(schema, f.type)
        const fieldMsgPath = swiftStringEscape(`${accessPath}.${f.name}`)
        assertions.push(
          `precondition(${accessPath}.${f.name}.count == ${fv.length}, "${fieldMsgPath} count: expected ${fv.length}, got \\(${accessPath}.${f.name}.count)")`
        )
        for (let j = 0; j < fv.length; j++) {
          assertions.push(
            ...generateAssertions(`${accessPath}.${f.name}[${j}]`, fv[j], elemType, schema)
          )
        }
      } else {
        assertions.push(
          ...generateAssertions(`${accessPath}.${f.name}`, fv, f.type, schema, isFieldOptional)
        )
      }
    }
    return assertions
  }
  const actualType = SUPPORTED_PRIMITIVE_TYPES.has(resolved) ? resolved : type
  return [
    `precondition(${path} == ${toSwiftLiteral(value, actualType, schema)}, "${msgPath}: expected ${toSwiftMessageLiteral(value, actualType)}, got \\(${path})")`
  ]
}

function getSchemaSwiftTypeName(typeName, schema) {
  if (SUPPORTED_PRIMITIVE_TYPES.has(typeName)) return getSwiftTypeName(typeName)
  const resolved = resolveAliasType(schema, typeName)
  if (SUPPORTED_PRIMITIVE_TYPES.has(resolved)) return getSwiftTypeName(resolved)
  const enumEntry = resolveEnumEntry(schema, typeName)
  if (enumEntry) return toSwiftTypeName(enumEntry.name)
  const structEntry = resolveStructEntry(schema, typeName)
  if (structEntry) return toSwiftTypeName(structEntry.name)
  throw new Error(`Cannot get Swift type name for: ${typeName}`)
}

function toSwiftRecordLiteral(value, valueType, schema) {
  const swiftValueType = getSchemaSwiftTypeName(valueType, schema)
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) return `[String: ${swiftValueType}]()`
  const items = entries.map(
    ([k, v]) => `${JSON.stringify(k)}: ${toSwiftLiteral(v, valueType, schema)}`
  )
  return `[${items.join(', ')}] as [String: ${swiftValueType}]`
}

function generateRecordAssertions(path, value, valueType, schema) {
  const entries = Object.entries(value)
  const assertions = [
    `precondition(${path}.count == ${entries.length}, "count: expected ${entries.length}, got \\(${path}.count)")`
  ]
  const structEntry = resolveStructEntry(schema, valueType)
  for (const [k, v] of entries) {
    const entryPath = `${path}[${JSON.stringify(k)}]`
    if (structEntry) {
      assertions.push(
        `precondition(${entryPath} != nil, "${swiftStringEscape(entryPath)}: expected non-nil")`
      )
      for (const f of structEntry.fields) {
        const fv = f.required ? v[f.name] : normOptional(v[f.name], f.type, schema)
        assertions.push(
          ...generateAssertions(`${entryPath}!.${f.name}`, fv, f.type, schema, !f.required)
        )
      }
    } else {
      assertions.push(...generateAssertions(entryPath, v, valueType, schema))
    }
  }
  return assertions
}

function resolveEnumEntry(schema, typeName) {
  const parts = typeName.startsWith('@') ? typeName.slice(1).split('/') : null
  if (!parts) return null
  return (
    schema.schema.find((s) => s.namespace === parts[0] && s.name === parts[1] && s.enum) || null
  )
}

function fixtureSupported(schema) {
  const structsByFqn = new Map()
  const enumsByFqn = new Map()
  for (const entry of schema.schema) {
    if (entry.fields) structsByFqn.set(`@${entry.namespace}/${entry.name}`, entry)
    if (entry.enum) enumsByFqn.set(`@${entry.namespace}/${entry.name}`, entry)
  }

  function isTypeSupported(typeName) {
    if (SUPPORTED_PRIMITIVE_TYPES.has(typeName)) return true
    const resolved = resolveAliasType(schema, typeName)
    if (SUPPORTED_PRIMITIVE_TYPES.has(resolved)) return true
    if (enumsByFqn.has(typeName) || enumsByFqn.has(resolved)) return true
    const structEntry = structsByFqn.get(typeName) || structsByFqn.get(resolved)
    if (structEntry) return isStructSupported(structEntry)
    return false
  }

  function isStructSupported(entry, visited = new Set()) {
    if (visited.has(entry)) return false
    visited.add(entry)
    return entry.fields.every((f) => {
      if (f.inline) return false
      const resolved = resolveAliasType(schema, f.type)
      const structEntry = structsByFqn.get(f.type) || structsByFqn.get(resolved)
      if (structEntry) return isStructSupported(structEntry, visited)
      return isTypeSupported(f.type)
    })
  }

  return schema.schema.every((entry) => {
    if (entry.alias) return isTypeSupported(entry.alias)
    if (entry.array) return isTypeSupported(entry.type)
    if (entry.enum) return true
    if (entry.record) return isTypeSupported(entry.value)
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
      } else if (entry.enum) {
        ns.register({
          name: entry.name,
          enum: entry.enum,
          offset: entry.offset || 0,
          strings: entry.strings || false
        })
      } else if (entry.record) {
        ns.register({ name: entry.name, record: true, key: entry.key, value: entry.value })
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

    if (primary.record) {
      const instanceName = toSwiftInstanceName(primary.name)
      cases.push({
        type: `@${primary.namespace}/${primary.name}`,
        value,
        encoded,
        swift: {
          codec: instanceName,
          encode: toSwiftRecordLiteral(value, primary.value, schema),
          assertions: generateRecordAssertions('decoded', value, primary.value, schema)
        }
      })
    } else if (primary.array) {
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
          const v = f.required ? value[f.name] : normOptional(value[f.name], f.type, schema)
          if (f.array) return `${f.name}: ${toSwiftArrayLiteral(v, f.type, schema)}`
          return `${f.name}: ${toSwiftLiteral(v, f.type, schema)}`
        })
        .join(', ')

      const assertions = []
      for (const f of primary.fields) {
        const v = f.required ? value[f.name] : normOptional(value[f.name], f.type, schema)
        if (f.array) {
          const elemType = resolveAliasType(schema, f.type)
          assertions.push(
            `precondition(decoded.${f.name}.count == ${v.length}, "${f.name} count: expected ${v.length}, got \\(decoded.${f.name}.count)")`
          )
          for (let j = 0; j < v.length; j++) {
            assertions.push(
              ...generateAssertions(`decoded.${f.name}[${j}]`, v[j], elemType, schema)
            )
          }
        } else {
          const isOptional = !f.required
          assertions.push(...generateAssertions(`decoded.${f.name}`, v, f.type, schema, isOptional))
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
