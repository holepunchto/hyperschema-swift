declare class SwiftHyperschema {
  toCode(): string

  static from(dir: string): SwiftHyperschema
  static toDisk(hyperschema: SwiftHyperschema, dir?: string | null): void
}

export = SwiftHyperschema
