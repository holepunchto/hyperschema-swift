'use strict'

const test = require('brittle')
const SwiftHyperschema = require('../index.js')

// A schema exercising every generator: alias, enum, struct (required +
// optional + bool, i.e. the flags path), nested struct, array, record, and
// versioned. The snapshot captures the exact generated source, so any codegen
// change shows up as a reviewable diff. Unlike the roundtrip tests it needs no
// Swift toolchain, so it guards the generator anywhere `swift run` can't run
// (e.g. a Windows runner, where the roundtrip tests self-skip).
// Refresh with `rm test/fixtures/snapshot.snapshot.cjs` and re-run.
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

test('codegen snapshot matches golden', (t) => {
  // Snapshot the source split into lines rather than as one multiline string.
  // brittle writes a multiline string to the snapshot as a raw backtick literal
  // with no escaping (lib/snapshot.js), so a `\` or `${` in the generated Swift
  // — e.g. a `\(...)` interpolation — gets mangled when the snapshot is
  // re-required, and the assert fails on every run after the first
  // (holepunchto/brittle#109). An array isn't a string, so brittle serializes it
  // via JSON.stringify, which escapes correctly no matter what the generator
  // emits.
  const code = buildSchema().toCode()
  t.snapshot(code.split('\n'))
})
