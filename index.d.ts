declare namespace SwiftHyperschema {
  interface Namespace {
    register(definition: object): void
  }
}

declare class SwiftHyperschema {
  // Builder surface inherited from Hyperschema, which ships no types.
  namespace(name: string): SwiftHyperschema.Namespace
  toJSON(): object
  readonly version: number

  // Generated Swift source for the registered schema.
  toCode(): string

  // `json` is an output directory to read schema.json from, or null to start
  // fresh. Passing a directory also sets it as the default `toDisk` target.
  static from(
    json?: string | null,
    opts?: { dir?: string | null; versioned?: boolean }
  ): SwiftHyperschema

  // Writes Package.swift, Sources/Schema.swift, and schema.json. Defaults the
  // directory to the one passed to `from`.
  static toDisk(hyperschema: SwiftHyperschema, dir?: string | null): void
}

export = SwiftHyperschema
