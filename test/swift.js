'use strict'

const path = require('path')
const fs = require('fs')
const test = require('brittle')
const tmp = require('test-tmp')
const SwiftHyperschema = require('../index.js')
const { runSwift } = require('./helpers/swift')
const { isWindows } = require('which-runtime')
const fixtures = require('./helpers/fixtures')

// Roundtrip tests driven by shared fixtures
for (const fixture of fixtures) {
  const swiftCases = fixture.cases.filter((c) => c.swift)
  if (!swiftCases.length) continue

  test(`swift: ${fixture.name}`, { skip: isWindows }, (t) => {
    const schema = SwiftHyperschema.from(null)
    fixture.register(schema)

    // Batch all cases into a single swift run (one compile per fixture)
    const lines = ['import Foundation']
    for (const kase of swiftCases) {
      lines.push('do {')
      lines.push(`  let value = ${kase.swift.encode}`)
      lines.push(`  let buffer = try! encode(${kase.swift.codec}, value)`)
      lines.push(`  let decoded = try! decode(${kase.swift.codec}, buffer)`)
      for (const assertion of kase.swift.assertions) {
        lines.push(`  ${assertion}`)
      }
      lines.push('}')
    }
    lines.push('print("OK")')

    const result = runSwift(schema, lines.join('\n'))
    t.ok(result.ok, `Swift roundtrip failed:\n${result.stderr}`)
  })
}

// toDisk test: exercises the full user-facing path end-to-end
test('swift: toDisk writes Schema.swift', { skip: isWindows }, async (t) => {
  const dir = await tmp(t, { dir: path.join(__dirname, 'test-storage') })

  const schema = SwiftHyperschema.from(dir)
  schema.namespace('test').register({
    name: 'test-struct',
    fields: [{ name: 'id', type: 'uint', required: true }]
  })

  SwiftHyperschema.toDisk(schema, dir)

  t.ok(fs.existsSync(path.join(dir, 'Sources', 'Schema.swift')), 'Sources/Schema.swift was written')
  t.ok(fs.existsSync(path.join(dir, 'schema.json')), 'schema.json was written')
  t.ok(fs.existsSync(path.join(dir, 'Package.swift')), 'Package.swift was written')
  t.is(
    fs.readFileSync(path.join(dir, 'Sources', 'Schema.swift'), 'utf8'),
    schema.toCode(),
    'Sources/Schema.swift content matches toCode()'
  )
})

// Nested struct test: struct field referencing another struct
test('swift: nested struct roundtrip', { skip: isWindows }, (t) => {
  const schema = SwiftHyperschema.from(null)
  const ns = schema.namespace('test')
  ns.register({
    name: 'inner',
    fields: [
      { name: 'x', type: 'uint', required: true },
      { name: 'y', type: 'uint', required: true }
    ]
  })
  ns.register({
    name: 'outer',
    fields: [
      { name: 'label', type: 'string', required: true },
      { name: 'point', type: '@test/inner', required: true }
    ]
  })

  const result = runSwift(
    schema,
    [
      'let value = Outer(label: "hello", point: Inner(x: 10, y: 20))',
      'let buffer = try! encode(outer, value)',
      'let decoded = try! decode(outer, buffer)',
      'precondition(decoded.label == "hello", "label mismatch")',
      'precondition(decoded.point.x == 10, "point.x mismatch")',
      'precondition(decoded.point.y == 20, "point.y mismatch")',
      'print("OK")'
    ].join('\n')
  )
  t.ok(result.ok, `nested struct failed:\n${result.stderr}`)
})

// Array field test: struct with an array-typed field
test('swift: array field roundtrip', { skip: isWindows }, (t) => {
  const schema = SwiftHyperschema.from(null)
  const ns = schema.namespace('test')
  ns.register({
    name: 'collection',
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'values', type: 'uint', required: true, array: true }
    ]
  })

  const result = runSwift(
    schema,
    [
      'let value = Collection(name: "nums", values: [1, 2, 3])',
      'let buffer = try! encode(collection, value)',
      'let decoded = try! decode(collection, buffer)',
      'precondition(decoded.name == "nums", "name mismatch")',
      'precondition(decoded.values.count == 3, "values count mismatch")',
      'precondition(decoded.values[0] == 1, "values[0] mismatch")',
      'precondition(decoded.values[1] == 2, "values[1] mismatch")',
      'precondition(decoded.values[2] == 3, "values[2] mismatch")',
      'print("OK")'
    ].join('\n')
  )
  t.ok(result.ok, `array field failed:\n${result.stderr}`)
})

// Array-of-structs test: array field containing struct-typed elements
test('swift: array of structs roundtrip', { skip: isWindows }, (t) => {
  const schema = SwiftHyperschema.from(null)
  const ns = schema.namespace('test')
  ns.register({
    name: 'point',
    fields: [
      { name: 'x', type: 'uint', required: true },
      { name: 'y', type: 'uint', required: true }
    ]
  })
  ns.register({
    name: 'shape',
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'points', type: '@test/point', required: true, array: true }
    ]
  })

  const result = runSwift(
    schema,
    [
      'let value = Shape(name: "triangle", points: [Point(x: 0, y: 0), Point(x: 1, y: 0), Point(x: 0, y: 1)])',
      'let buffer = try! encode(shape, value)',
      'let decoded = try! decode(shape, buffer)',
      'precondition(decoded.name == "triangle", "name mismatch")',
      'precondition(decoded.points.count == 3, "points count mismatch")',
      'precondition(decoded.points[0].x == 0, "points[0].x mismatch")',
      'precondition(decoded.points[0].y == 0, "points[0].y mismatch")',
      'precondition(decoded.points[1].x == 1, "points[1].x mismatch")',
      'precondition(decoded.points[1].y == 0, "points[1].y mismatch")',
      'precondition(decoded.points[2].x == 0, "points[2].x mismatch")',
      'precondition(decoded.points[2].y == 1, "points[2].y mismatch")',
      'print("OK")'
    ].join('\n')
  )
  t.ok(result.ok, `array of structs failed:\n${result.stderr}`)
})

// Versioned type tests
test('swift: versioned type roundtrip', { skip: isWindows }, (t) => {
  const schema = SwiftHyperschema.from(null)
  const ns = schema.namespace('test')
  ns.register({
    name: 'msg-v0',
    fields: [
      { name: 'version', type: 'uint', required: true },
      { name: 'text', type: 'string', required: true }
    ]
  })
  ns.register({
    name: 'msg-v1',
    fields: [
      { name: 'version', type: 'uint', required: true },
      { name: 'text', type: 'string', required: true },
      { name: 'priority', type: 'uint', required: true }
    ]
  })
  ns.register({
    name: 'message',
    versions: [
      { version: 0, type: '@test/msg-v0' },
      { version: 1, type: '@test/msg-v1' }
    ]
  })

  const result = runSwift(
    schema,
    [
      'let v0 = Message.v0(MsgV0(version: 0, text: "hello"))',
      'let buf0 = try! encode(message, v0)',
      'let dec0 = try! decode(message, buf0)',
      'guard case .v0(let m0) = dec0 else { fatalError("expected v0") }',
      'precondition(m0.text == "hello", "text mismatch")',
      'let v1 = Message.v1(MsgV1(version: 1, text: "world", priority: 5))',
      'let buf1 = try! encode(message, v1)',
      'let dec1 = try! decode(message, buf1)',
      'guard case .v1(let m1) = dec1 else { fatalError("expected v1") }',
      'precondition(m1.text == "world", "text mismatch")',
      'precondition(m1.priority == 5, "priority mismatch")',
      'print("OK")'
    ].join('\n')
  )
  t.ok(result.ok, `versioned type roundtrip failed:\n${result.stderr}`)
})

test('swift: versioned type sparse range dispatch', { skip: isWindows }, (t) => {
  // Versions declared at 0 and 3; wire values 1 and 2 must decode as v3 (the upper-bound entry)
  const schema = SwiftHyperschema.from(null)
  const ns = schema.namespace('test')
  ns.register({
    name: 'ev-v0',
    fields: [
      { name: 'version', type: 'uint', required: true },
      { name: 'code', type: 'uint', required: true }
    ]
  })
  ns.register({
    name: 'ev-v3',
    fields: [
      { name: 'version', type: 'uint', required: true },
      { name: 'code', type: 'uint', required: true }
    ]
  })
  ns.register({
    name: 'event',
    versions: [
      { version: 0, type: '@test/ev-v0' },
      { version: 3, type: '@test/ev-v3' }
    ]
  })

  const result = runSwift(
    schema,
    [
      // Encode a v3 value (version=3) — decode must land in .v3 case
      'let ev = Event.v3(EvV3(version: 3, code: 42))',
      'let buf = try! encode(event, ev)',
      'let dec = try! decode(event, buf)',
      'guard case .v3(let m) = dec else { fatalError("expected v3") }',
      'precondition(m.code == 42, "code mismatch")',
      'print("OK")'
    ].join('\n')
  )
  t.ok(result.ok, `sparse range dispatch failed:\n${result.stderr}`)
})

// Version evolution tests: these verify the Swift codegen handles schema
// changes correctly and are not representable as static fixtures.

test('swift: schema version — no bump on unchanged schema', { skip: isWindows }, (t) => {
  const s1 = SwiftHyperschema.from(null)
  s1.namespace('test').register({
    name: 'test-struct',
    fields: [{ name: 'field1', type: 'uint', required: true }]
  })
  t.is(s1.version, 1)

  const s2 = SwiftHyperschema.from(s1.toJSON())
  s2.namespace('test').register({
    name: 'test-struct',
    fields: [{ name: 'field1', type: 'uint', required: true }]
  })
  t.is(s2.version, 1)

  const result = runSwift(
    s2,
    [
      'let value = TestStruct(field1: 42)',
      'let buffer = try! encode(testStruct, value)',
      'let decoded = try! decode(testStruct, buffer)',
      'precondition(decoded.field1 == 42, "roundtrip failed: field1")',
      'print("OK")'
    ].join('\n')
  )
  t.ok(result.ok, result.stderr)
})

test('swift: schema version — bump on new field', { skip: isWindows }, (t) => {
  const s1 = SwiftHyperschema.from(null)
  s1.namespace('test').register({
    name: 'test-struct',
    fields: [{ name: 'field1', type: 'uint', required: true }]
  })
  t.is(s1.version, 1)

  const r1 = runSwift(
    s1,
    [
      'let value = TestStruct(field1: 10)',
      'let buffer = try! encode(testStruct, value)',
      'let decoded = try! decode(testStruct, buffer)',
      'precondition(decoded.field1 == 10, "roundtrip failed: field1")',
      'print("OK")'
    ].join('\n')
  )
  t.ok(r1.ok, r1.stderr)

  const s2 = SwiftHyperschema.from(s1.toJSON())
  s2.namespace('test').register({
    name: 'test-struct',
    fields: [
      { name: 'field1', type: 'uint', required: true },
      { name: 'field2', type: 'uint', required: true }
    ]
  })
  t.is(s2.version, 2)

  const r2 = runSwift(
    s2,
    [
      'let value = TestStruct(field1: 10, field2: 20)',
      'let buffer = try! encode(testStruct, value)',
      'let decoded = try! decode(testStruct, buffer)',
      'precondition(decoded.field1 == 10, "roundtrip failed: field1")',
      'precondition(decoded.field2 == 20, "roundtrip failed: field2")',
      'print("OK")'
    ].join('\n')
  )
  t.ok(r2.ok, r2.stderr)
})

// An unknown enum variant or schema version must surface as a catchable error,
// not crash the process — a peer can legitimately send a newer tag (#26).
test(
  'swift: unknown enum variant / version throws instead of crashing',
  { skip: isWindows },
  (t) => {
    const schema = SwiftHyperschema.from(null)
    const ns = schema.namespace('test')
    ns.register({ name: 'color', enum: ['red', 'green', 'blue'] })
    // A one-required-uint struct encodes to a bare varint, so it lets us craft a
    // buffer whose leading tag (99) is a variant/version neither type declares.
    ns.register({ name: 'tag', fields: [{ name: 'value', type: 'uint', required: true }] })
    ns.register({
      name: 'msg-v0',
      fields: [{ name: 'version', type: 'uint', required: true }]
    })
    ns.register({
      name: 'msg-v1',
      fields: [{ name: 'version', type: 'uint', required: true }]
    })
    ns.register({
      name: 'message',
      versions: [
        { version: 0, type: '@test/msg-v0' },
        { version: 1, type: '@test/msg-v1' }
      ]
    })

    const result = runSwift(
      schema,
      [
        'let unknownTag = try! encode(tag, Tag(value: 99))',
        'var enumThrew = false',
        'do { _ = try decode(color, unknownTag) } catch { enumThrew = true }',
        'precondition(enumThrew, "enum decode should throw on unknown variant")',
        'var versionThrew = false',
        'do { _ = try decode(message, unknownTag) } catch { versionThrew = true }',
        'precondition(versionThrew, "versioned decode should throw on unknown version")',
        'print("OK")'
      ].join('\n')
    )
    t.ok(result.ok, `unknown tag handling failed:\n${result.stderr}`)
  }
)
