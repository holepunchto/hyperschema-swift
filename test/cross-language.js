'use strict'

const test = require('brittle')
const SwiftHyperschema = require('../index.js')
const { runSwift } = require('./helpers/swift')
const { isWindows } = require('which-runtime')
const fixtures = require('./helpers/fixtures')

for (const fixture of fixtures) {
  const swiftCases = fixture.cases.filter((kase) => kase.swift)
  if (!swiftCases.length) continue

  // Canonical bytes → Swift decodes
  test(`cross-language: ${fixture.name}: canonical → Swift`, { skip: isWindows }, (t) => {
    const swiftSchema = SwiftHyperschema.from(null)
    fixture.register(swiftSchema)

    const lines = ['import Foundation']
    for (const kase of swiftCases) {
      const base64 = Buffer.from(kase.encoded, 'hex').toString('base64')

      lines.push('do {')
      lines.push(`  let data = Data(base64Encoded: "${base64}")!`)
      lines.push(`  let decoded = try! decode(${kase.swift.codec}, data)`)
      for (const assertion of kase.swift.assertions) {
        lines.push(`  ${assertion}`)
      }
      lines.push('}')
    }
    lines.push('print("OK")')

    const result = runSwift(swiftSchema, lines.join('\n'))
    t.ok(result.ok, `canonical→Swift failed:\n${result.stderr}`)
  })

  // Swift encodes → verify matches canonical bytes
  test(`cross-language: ${fixture.name}: Swift → canonical`, { skip: isWindows }, (t) => {
    const swiftSchema = SwiftHyperschema.from(null)
    fixture.register(swiftSchema)

    const lines = ['import Foundation']
    for (const kase of swiftCases) {
      lines.push('do {')
      lines.push(`  let value = ${kase.swift.encode}`)
      lines.push(`  let buffer = encode(${kase.swift.codec}, value)`)
      lines.push('  print(buffer.base64EncodedString())')
      lines.push('}')
    }

    const result = runSwift(swiftSchema, lines.join('\n'))
    t.ok(result.ok, `Swift encode failed:\n${result.stderr}`)

    const outputs = result.stdout.trim().split('\n')
    for (let i = 0; i < swiftCases.length; i++) {
      const expected = Buffer.from(swiftCases[i].encoded, 'hex')
      const actual = Buffer.from(outputs[i], 'base64')
      t.alike(actual, expected, `byte mismatch for ${JSON.stringify(swiftCases[i].value)}`)
    }
  })
}
