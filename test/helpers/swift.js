'use strict'

const { spawnSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const SwiftHyperschema = require('../../index.js')

const WORKSPACE = path.join(__dirname, '../swift-workspace')
const SOURCES = path.join(WORKSPACE, 'Sources')
const TIMEOUT = 120000

// toDisk() emits a library target (.target) suitable for users who import
// Schema as a package dependency. Tests need an executable to run `swift run`,
// so runSwift overwrites Package.swift with this executable-specific manifest.
const TEST_PACKAGE_SWIFT = `// swift-tools-version: 5.10
import PackageDescription

let package = Package(
  name: "Schema",
  platforms: [.macOS(.v13), .iOS(.v15)],
  dependencies: [
    .package(url: "https://github.com/holepunchto/compact-encoding-swift", branch: "main")
  ],
  targets: [
    .executableTarget(
      name: "Schema",
      dependencies: [.product(name: "CompactEncoding", package: "compact-encoding-swift")],
      path: "Sources"
    )
  ]
)
`

// SwiftPM's incremental build can miss a rewrite of main.swift that lands
// shortly after the previous build and rerun the stale binary. Dropping the
// target's intermediates forces it to recompile. Their location depends on the
// build system, e.g. .build/<triple>/debug/Schema.build or
// .build/out/Intermediates.noindex/Schema.build.
function removeStaleIntermediates(dir = path.join(WORKSPACE, '.build'), depth = 3) {
  if (depth === 0 || !fs.existsSync(dir)) return

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'checkouts') continue

    const entryPath = path.join(dir, entry.name)
    if (entry.name === 'Schema.build') fs.rmSync(entryPath, { recursive: true, force: true })
    else removeStaleIntermediates(entryPath, depth - 1)
  }
}

// runSwift calls are synchronous (spawnSync blocks the event loop), so
// concurrent calls within the same process cannot interleave in the workspace.
function runSwift(hyperschema, mainSwift) {
  // Use toDisk() to generate Schema.swift and schema.json so the workspace
  // always matches what users get. Then overwrite Package.swift with the
  // executable-target manifest needed for `swift run`.
  SwiftHyperschema.toDisk(hyperschema, WORKSPACE)
  fs.writeFileSync(path.join(WORKSPACE, 'Package.swift'), TEST_PACKAGE_SWIFT)
  fs.writeFileSync(path.join(SOURCES, 'main.swift'), mainSwift)
  removeStaleIntermediates()

  const result = spawnSync('swift', ['run'], {
    cwd: WORKSPACE,
    encoding: 'utf8',
    timeout: TIMEOUT
  })

  const timedOut = result.error && result.error.code === 'ETIMEDOUT'
  return {
    ok: result.status === 0 && !timedOut,
    stdout: result.stdout ? result.stdout.toString() : '',
    stderr: timedOut
      ? `[swift run timed out after ${TIMEOUT}ms] ${result.error.message}`
      : result.stderr
        ? result.stderr.toString()
        : ''
  }
}

module.exports = { runSwift }
