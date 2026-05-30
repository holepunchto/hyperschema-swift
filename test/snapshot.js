'use strict'

const fs = require('fs')
const path = require('path')
const test = require('brittle')
const SwiftHyperschema = require('../index.js')

const GOLDEN = path.join(__dirname, 'snapshots', 'schema.swift')

// A schema exercising every generator: alias, enum, struct (required +
// optional + bool, i.e. the flags path), nested struct, array, record, and
// versioned. The golden file captures the exact generated source, so any
// codegen change shows up as a reviewable diff. Unlike the roundtrip tests it
// needs no Swift toolchain, so it guards the generator anywhere `swift run`
// can't run (e.g. a Windows runner, where the roundtrip tests self-skip).
// Refresh with UPDATE_SNAPSHOTS=1.
function buildSchema() {
  const schema = SwiftHyperschema.from(null)
  const ns = schema.namespace('demo')
  ns.register({ name: 'score', alias: 'uint' })
  ns.register({ name: 'color', enum: ['red', 'green', 'blue'] })
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
      { name: 'label', type: 'string', required: true },
      { name: 'origin', type: '@demo/point', required: true },
      { name: 'tag', type: '@demo/color', required: true },
      { name: 'weight', type: 'uint' },
      { name: 'blob', type: 'buffer' },
      { name: 'filled', type: 'bool' }
    ]
  })
  ns.register({ name: 'points', array: true, type: '@demo/point' })
  ns.register({ name: 'scores', record: true, key: 'string', value: 'uint' })
  ns.register({
    name: 'msg-v0',
    fields: [{ name: 'version', type: 'uint', required: true }]
  })
  ns.register({
    name: 'msg-v1',
    fields: [
      { name: 'version', type: 'uint', required: true },
      { name: 'note', type: 'string', required: true }
    ]
  })
  ns.register({
    name: 'message',
    versions: [
      { version: 0, type: '@demo/msg-v0' },
      { version: 1, type: '@demo/msg-v1' }
    ]
  })
  return schema
}

// Bare has no global `process`; only Node refreshes the golden (typeof on an
// undeclared global is safe and returns 'undefined' rather than throwing).
const UPDATE_SNAPSHOTS = typeof process !== 'undefined' && !!process.env.UPDATE_SNAPSHOTS

test('codegen snapshot matches golden', (t) => {
  const code = buildSchema().toCode()

  if (UPDATE_SNAPSHOTS) {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true })
    fs.writeFileSync(GOLDEN, code)
    t.pass('snapshot updated')
    return
  }

  const golden = fs.readFileSync(GOLDEN, 'utf8')
  t.is(code, golden, 'generated Swift matches the golden (UPDATE_SNAPSHOTS=1 to refresh)')
})
