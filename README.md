# hyperschema-swift

Swift code generation for [Hyperschema](https://github.com/holepunchto/hyperschema). Transforms schema definitions into Swift structs with binary codec conformance using <https://github.com/holepunchto/compact-encoding-swift>.

```
npm i hyperschema-swift
```

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

## License

Apache-2.0
