# hyperschema-swift

Swift code generation for [hyperschema](https://github.com/holepunchto/hyperschema). Transforms schema definitions into Swift structs with binary codec conformance using [compact-encoding-swift](https://github.com/holepunchto/compact-encoding-swift).

## Usage

```js
const SwiftHyperschema = require('hyperschema-swift')
const Hyperschema = require('hyperschema')

const schema = Hyperschema.from('./spec')

// Get generated Swift source as a string
const swift = new SwiftHyperschema(schema)
const code = swift.toCode()

// Or write a complete Swift package to disk
SwiftHyperschema.toDisk(schema, './output')
```

`toDisk` writes a ready-to-build Swift package:

```
output/
  Package.swift
  Sources/Schema.swift
  schema.json
```

## Install

```
npm install hyperschema-swift
```

## License

Apache-2.0
