# Implementation Plan: Feature Parity with hyperschema

## Overview

`hyperschema-swift` generates Swift code from hyperschema definitions. It currently handles a narrow slice of the schema model: required fields only, four primitive types (`uint`, `bool`, `string`, `buffer`), plain structs, and arrays. The JS reference implementation (`../hyperschema`) supports a much richer model. This plan closes that gap systematically, fixture by fixture.

The fixture suite in `hyperschema-test` defines 28 test categories. The current Swift codegen passes roughly 10 of them. After this plan, it should pass all 28.

---

## Architecture Decisions

- **No new files**: all changes land in `lib/codegen.js` (codegen) and `test/helpers/fixtures.js` (test filter). The task structure in `index.js` stays untouched.
- **Swift optionals for optional fields**: optional schema fields become `T?` in Swift, matching Swift idioms and making nil-checks natural.
- **Flag bitfield as `UInt`**: use variable-length `UInt` for the flags word (matches JS codegen default). Compact structs use a fixed-size flag determined by `maxFlag`.
- **Framing gated by `field.framed`**: the `field.framed` property on hyperschema fields drives whether a `Primitive.Frame()` wrapper is emitted around a struct codec. This gives forward-compat without requiring us to re-derive the logic.
- **compact-encoding-swift primitives (verified)**: the library exposes the following — see Task 1.1 findings below. `Primitive.Frame()` and `Primitive.Record()` are absent; Phases 4 and 5 will implement them inline in generated code.

---

## Dependency Graph

```
lib/codegen.js — getSwiftType / getSwiftCodecVar / getSwiftCodecInit
        │
        ├── Phase 1: Primitive type expansion
        │       (required before anything using int/float/fixed-width uints)
        │
        ├── Phase 2: Optional fields + flags
        │       (required before any fixture with optional fields)
        │       │
        │       └── Phase 5: Framing
        │               (depends on Phase 2 for complete optional field semantics)
        │
        ├── Phase 3: Enums
        │       (standalone; depends only on Phase 1 for enum value types)
        │
        ├── Phase 4: Records
        │       (standalone; depends only on Phase 1 for key/value types)
        │
        ├── Phase 6: Compact flag + fixed-size flags word
        │       (enhances Phase 2; needed for inline fields)
        │       │
        │       └── Phase 7: Inline fields
        │               (depends on Phase 2 + Phase 6)
        │
        └── Phase 8: Versioned types
                (standalone; depends on Phase 1 for version field type)
```

---

## Task List

### Phase 1: Primitive Type Expansion

#### Task 1.1: Verify compact-encoding-swift primitive coverage

**Description:** Before writing a line of codegen, confirm which primitives `compact-encoding-swift` exposes. Clone or read the package's public API. Record which of the following exist: `Primitive.Int()`, `Primitive.UInt8/16/32/64()`, `Primitive.Int8/16/32/64()`, `Primitive.Float32()`, `Primitive.Float64()`, `Primitive.Frame()`, `Primitive.Record()`.

**Acceptance criteria:**

- [x] A note in this file lists what's available and what's missing.
- [x] Any missing primitive is flagged so the corresponding task can be adjusted.

**Verification:** Run `npm test` — it must still pass (no regressions).

**Dependencies:** None

**Files likely touched:** None (research only)

**Estimated scope:** XS

**Findings (compact-encoding-swift @ main, checked 2026-05-11):**

Available — all good for Phases 1–3, 6, 7, 8:

| Codec                                   | Swift type        | Notes                     |
| --------------------------------------- | ----------------- | ------------------------- |
| `Primitive.UInt()`                      | `Swift.UInt`      | variable-length zigzag    |
| `Primitive.UInt8()`                     | `Swift.UInt8`     | fixed 1 byte              |
| `Primitive.UInt16()`                    | `Swift.UInt16`    | fixed 2 bytes LE          |
| `Primitive.UInt32()`                    | `Swift.UInt32`    | fixed 4 bytes LE          |
| `Primitive.UInt64()`                    | `Swift.UInt64`    | fixed 8 bytes LE          |
| `Primitive.Int()`                       | `Swift.Int`       | variable-length zigzag    |
| `Primitive.Int8()`                      | `Swift.Int8`      | zigzag over UInt8         |
| `Primitive.Int16()`                     | `Swift.Int16`     | zigzag over UInt16        |
| `Primitive.Int32()`                     | `Swift.Int32`     | zigzag over UInt32        |
| `Primitive.Int64()`                     | `Swift.Int64`     | zigzag over UInt64        |
| `Primitive.Float32()`                   | `Swift.Float`     | 4 bytes IEEE 754 LE       |
| `Primitive.Float64()`                   | `Swift.Double`    | 8 bytes IEEE 754 LE       |
| `Primitive.Bool()`                      | `Swift.Bool`      | single byte               |
| `Primitive.UTF8()` / `Primitive.String` | `Swift.String`    | length-prefixed UTF-8     |
| `Primitive.Buffer()`                    | `Foundation.Data` | length-prefixed raw bytes |
| `Primitive.Array<C>()`                  | `[C.Value]`       | length-prefixed array     |

Missing — must be handled in-codegen:

| Feature                   | Impact                | Strategy                                                                                   |
| ------------------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `Primitive.Frame()`       | Phase 5 framing       | Implement inline as a generated struct or a helper emitted once at the top of Schema.swift |
| `Primitive.Record()`      | Phase 4 records       | Implement inline — a generic `[K: V]` codec keyed on two child codecs                      |
| `json` type               | Fixture 25            | Blocked by library; defer — no Swift JSON codec in the library                             |
| Network types (ip, ipv4…) | None in test fixtures | Defer                                                                                      |
| BigInt types              | None in test fixtures | Defer                                                                                      |

---

#### Task 1.2: Add common numeric and float types to codegen

**Description:** Extend the three type-mapping functions in `lib/codegen.js` (`getSwiftType`, `getSwiftCodecVar`, `getSwiftCodecInit`) with: `int` → `Int` / `Primitive.Int()`, `uint8/16/32` → `UInt8/16/32` / `Primitive.UInt8/16/32()`, `float32` → `Float` / `Primitive.Float32()`, `float64` → `Double` / `Primitive.Float64()`. Update `SUPPORTED_PRIMITIVE_TYPES` in `test/helpers/fixtures.js` to include these types so the fixture filter lets them through.

**Acceptance criteria:**

- [ ] Fixture 13 (uint8/uint16/uint32) passes Swift roundtrip test.
- [ ] Fixture 14 (int) passes Swift roundtrip test.
- [ ] Fixture 30 (float32) passes Swift roundtrip test.
- [ ] Fixture 31 (float64) passes Swift roundtrip test.
- [ ] Fixture 4 (bool-and-float64) passes Swift roundtrip test.
- [ ] Fixture 15 (float32-and-float64) passes Swift roundtrip test.
- [ ] All previously passing tests continue to pass.

**Verification:** `npm run test:swift`

**Dependencies:** Task 1.1 (confirm primitives exist)

**Files likely touched:**

- `lib/codegen.js` (3 functions, ~20 lines each)
- `test/helpers/fixtures.js` (SUPPORTED_PRIMITIVE_TYPES set)

**Estimated scope:** S

---

### Checkpoint: Phase 1

- [ ] `npm run test:swift` passes, with fixtures 4, 13, 14, 15, 30, 31 newly green.
- [ ] `npm run test:cross-language` passes (no regressions).
- [ ] Review with human before proceeding.

---

### Phase 2: Optional Fields with Flags

#### Task 2.1: Classify fields and compute flagsPosition

**Description:** Rewrite `generateStruct` in `lib/codegen.js` to correctly split fields into three groups: required fields before the flags word, the flags word itself (at `struct.flagsPosition`), and optional fields after it. Use `field.required` to distinguish required from optional. Read `struct.flagsPosition` directly from the schema object.

Also emit the `let flags` computation in Swift: iterate optional fields to build the flags integer (1-bit per optional field that is non-nil). The flag assignment order must match the JS codegen's `field.flag` bitmask values.

**Acceptance criteria:**

- [ ] Structs with `flagsPosition: -1` (no optional fields, no flags word) generate no flags logic.
- [ ] Structs with optional fields generate a `var flags: UInt` at the correct position.
- [ ] Generated `preencode` accumulates flags correctly using `field.flag` bitmasks.
- [ ] Unit test: schema with one required + one optional field generates code that compiles.

**Verification:** `swift build` on generated code for fixture 16 schema (sparse: id required, score/tag optional).

**Dependencies:** Task 1.2

**Files likely touched:**

- `lib/codegen.js` (`generateStruct` function, ~80 lines added/changed)

**Estimated scope:** M

---

#### Task 2.2: Swift struct optional field types

**Description:** In `generateStruct`, emit optional fields as `T?` in the Swift struct definition and `init`. Required fields remain non-optional. Update `getFieldSwiftType` to accept and respect an `optional` flag. Update `init` parameter list to make optional fields default to `nil`.

**Acceptance criteria:**

- [ ] Generated Swift struct has `var score: UInt?` for an optional uint field.
- [ ] `init` defaults optional fields to `nil` (e.g., `score: UInt? = nil`).
- [ ] Required fields remain non-optional (`var id: UInt`).
- [ ] All currently passing tests still pass.

**Verification:** Compile generated struct definition in isolation.

**Dependencies:** Task 2.1

**Files likely touched:**

- `lib/codegen.js` (`generateStruct`, `getFieldSwiftType`)

**Estimated scope:** S

---

#### Task 2.3: Conditional encode / decode with flags

**Description:** Update the generated `preencode`, `encode`, and `decode` methods to handle optional fields:

- `preencode`: write the flags word (1 byte if `maxFlag < 128`), then for each optional field that is non-nil, call `preencode` on it.
- `encode`: write the flags word, then conditionally encode each optional field.
- `decode`: decode the flags word, then for each optional field, if the corresponding flag bit is set decode the field, otherwise use `nil`.

**Acceptance criteria:**

- [ ] Fixture 16 (use-default: id required, score/tag optional) passes Swift roundtrip.
- [ ] Fixture 11 (flags-position: all fields optional, flagsPosition=0) passes Swift roundtrip.
- [ ] Fixture 18 (multiple-optional-flags: rich struct with 5 optional fields) passes Swift roundtrip.
- [ ] Cross-language tests for the above fixtures pass.

**Verification:** `npm run test:swift && npm run test:cross-language`

**Dependencies:** Task 2.2

**Files likely touched:**

- `lib/codegen.js` (`generateStruct` encode/decode sections)

**Estimated scope:** M

---

### Checkpoint: Phase 2

- [ ] `npm run test:swift` passes, with fixtures 11, 16, 18 newly green.
- [ ] `npm run test:cross-language` passes with no regressions.
- [ ] Fixture filter in `test/helpers/fixtures.js` updated to allow structs with optional fields.
- [ ] Review with human before proceeding.

---

### Phase 3: Enums

#### Task 3.1: Generate numeric enums

**Description:** In `lib/codegen.js`, add a `generateEnum` function for types where `type.isEnum && !type.strings`. Emit a Swift `enum` with an integer raw value (offset from `struct.offset`), plus an `EnumCodec` struct with `preencode`, `encode`, and `decode` methods that translate enum cases to/from `UInt`. Update the main generation loop to call `generateEnum` for enum types.

**Acceptance criteria:**

- [ ] Fixture 21 (enum-numeric: Color with red/green/blue, offset=1) passes Swift roundtrip.
- [ ] Fixture 21 passes cross-language test.
- [ ] All previously passing tests continue to pass.

**Verification:** `npm run test:swift && npm run test:cross-language`

**Dependencies:** Phase 1

**Files likely touched:**

- `lib/codegen.js` (new `generateEnum`, updated main loop)

**Estimated scope:** S

---

#### Task 3.2: Generate string enums

**Description:** Extend `generateEnum` to handle `type.strings === true`. Emit a Swift `enum` with a `String` raw value (key = case name), and an `EnumCodec` that encodes the enum as a `UInt` index and decodes by switching on the index.

**Acceptance criteria:**

- [ ] Fixture 22 (enum-strings) passes Swift roundtrip.
- [ ] Fixture 22 passes cross-language test.

**Verification:** `npm run test:swift && npm run test:cross-language`

**Dependencies:** Task 3.1

**Files likely touched:**

- `lib/codegen.js` (`generateEnum` extended)

**Estimated scope:** XS

---

### Checkpoint: Phase 3

- [ ] Fixtures 21 and 22 are green.
- [ ] `npm run test:cross-language` clean.
- [ ] Review with human before proceeding.

---

### Phase 4: Records

#### Task 4.1: Verify compact-encoding-swift Record support

**Description:** Check whether `compact-encoding-swift` exposes `Primitive.Record()` or equivalent. If not, determine whether we can implement it in Swift inline in the generated code or whether this phase should be deferred.

**Acceptance criteria:**

- [ ] Decision documented (skip, inline, or use library).

**Verification:** Read the library source or Swift package manifest.

**Dependencies:** None (can run in parallel with Phase 3)

**Files likely touched:** None

**Estimated scope:** XS

---

#### Task 4.2: Generate record codecs

**Description:** In `lib/codegen.js`, update the main loop to handle `type.isRecord`. Emit a `let <name> = Primitive.Record(<keyCodec>, <valueCodec>)` constant (or equivalent inline implementation if the library doesn't expose it). Update the fixture filter in `test/helpers/fixtures.js` to allow record types.

**Acceptance criteria:**

- [ ] Fixture 23 (record-string-uint: `[String: UInt]`) passes Swift roundtrip.
- [ ] Fixture 24 (record-string-struct) passes Swift roundtrip.
- [ ] All previously passing tests continue to pass.

**Verification:** `npm run test:swift && npm run test:cross-language`

**Dependencies:** Task 4.1, Phase 1

**Files likely touched:**

- `lib/codegen.js` (main loop + record generation)
- `test/helpers/fixtures.js` (filter)

**Estimated scope:** S

---

### Checkpoint: Phase 4

- [ ] Fixtures 23 and 24 are green.
- [ ] `npm run test:cross-language` clean.
- [ ] Review with human before proceeding.

---

### Phase 5: Framing for Non-Compact Struct Fields

#### Task 5.1: Add frame wrapper for framed fields

**Description:** In `generateStruct` (and `getFieldCodecInit`), check `field.framed` on each field. When true, wrap the field's codec with `Primitive.Frame(<codec>)` (for single fields) or keep the array frame behavior (`Primitive.Array(Primitive.Frame(<codec>))`). This matches what the JS codegen does with `c.frame()`.

This is required for binary compatibility when a struct with optional fields is embedded in another struct: the framing length prefix lets old decoders skip forward-compatible additions.

**Acceptance criteria:**

- [ ] A struct with a non-compact embedded struct field encodes with a length-prefixed frame.
- [ ] A struct with a compact embedded struct field does NOT add a frame.
- [ ] Cross-language test for fixture 8 (nested-struct) still passes with framing.
- [ ] No previously passing test breaks.

**Verification:** `npm run test:swift && npm run test:cross-language`

**Dependencies:** Phase 2 (framing matters most once optional fields are in play), Task 1.1 (verify `Primitive.Frame` exists)

**Files likely touched:**

- `lib/codegen.js` (`generateStruct`, codec init helpers)

**Estimated scope:** S

---

### Checkpoint: Phase 5

- [ ] All nested-struct fixtures pass with correct framing.
- [ ] `npm run test:cross-language` clean.
- [ ] Review with human before proceeding.

---

### Phase 6: Compact Flag + Fixed-Size Flags Word

#### Task 6.1: Use fixed-size flags word for compact structs

**Description:** When `struct.compact === true`, the flags word is fixed-size (determined by `maxFlag`). Update flag encoding to use the appropriate fixed-width codec (`UInt8`, `UInt16`, etc.) rather than variable-length `UInt`. This matches the JS codegen's `getFittingType(struct.maxFlag)` logic.

**Acceptance criteria:**

- [ ] Fixture 3 (compact struct: `point` with `x` and `y` int fields, no optional fields) passes.
- [ ] Compact struct flag size matches the JS-generated encoding byte-for-byte.
- [ ] No previously passing test breaks.

**Verification:** `npm run test:swift && npm run test:cross-language`

**Dependencies:** Phase 2 (flag encoding path)

**Files likely touched:**

- `lib/codegen.js` (flag type selection)

**Estimated scope:** XS

---

### Phase 7: Inline Fields

#### Task 7.1: Generate inline codec for compact struct fields

**Description:** A field with `inline: true` embeds its compact struct's fields directly into the parent struct's flags bitfield, rather than as a separate encoded field. This is an optimization for compact nested structs. Update `generateStruct` to detect `field.inline`, emit a separate `<Name>InlineCodec` conformance (mirroring the JS `_inline` suffix), and call `inlineCodec.decode(state, shift)` passing the appropriate flag shift.

**Acceptance criteria:**

- [ ] Fixture 12 (inline-compact: `packet` with `meta` inlined) passes Swift roundtrip.
- [ ] Fixture 12 passes cross-language test.
- [ ] No previously passing test breaks.

**Verification:** `npm run test:swift && npm run test:cross-language`

**Dependencies:** Phase 6 (compact flag sizes), Phase 2 (flags infrastructure)

**Files likely touched:**

- `lib/codegen.js` (inline codec generation, ~60 new lines)

**Estimated scope:** M

---

### Checkpoint: Phase 7

- [ ] Fixture 12 is green.
- [ ] Review with human before proceeding.

---

### Phase 8: Versioned Types

#### Task 8.1: Generate versioned type dispatch

**Description:** A versioned type (`struct.isVersioned === true`) dispatches to different struct codecs based on a leading version integer in the encoded data. Add a `generateVersioned` function that produces a Swift struct with `preencode`, `encode`, and `decode` methods that switch on the `version` field. The Swift value type for a versioned type is a tagged union (or protocol). The simplest approach is a Swift `enum` with associated values, one case per version.

**Acceptance criteria:**

- [ ] Fixture 26 (versioned-dispatch: `message` dispatches to `msgV0` or `msgV1`) passes Swift roundtrip.
- [ ] Fixture 26 passes cross-language test.
- [ ] All previously passing tests continue to pass.

**Verification:** `npm run test:swift && npm run test:cross-language`

**Dependencies:** Phase 2 (flagsPosition handling for the versioned struct versions)

**Files likely touched:**

- `lib/codegen.js` (`generateVersioned`, main loop update)

**Estimated scope:** M

---

### Checkpoint: Phase 8

- [ ] Fixture 26 is green.
- [ ] `npm run test:cross-language` clean.
- [ ] All 28 fixture categories pass or are explicitly deferred with a documented reason.
- [ ] Review with human before declaring parity.

---

## Risks and Mitigations

| Risk                                                            | Impact                        | Mitigation                                                                             |
| --------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| `compact-encoding-swift` missing `Primitive.Frame()`            | High — needed for Phase 5     | Verify in Task 1.1; open upstream issue; implement inline if needed                    |
| `compact-encoding-swift` missing `Primitive.Record()`           | Medium — needed for Phase 4   | Verify in Task 4.1; inline a simple record codec in generated code if missing          |
| `compact-encoding-swift` missing fixed-width int/float types    | Medium — needed for Phase 1   | Verify in Task 1.1; implement fallback casts or skip affected fixtures                 |
| Inline field flag shift arithmetic differs between Swift and JS | High — binary incompatibility | Cross-language tests catch this immediately; study JS `shiftRight/shiftLeft` carefully |
| Versioned type Swift representation is awkward                  | Low — API ergonomics only     | Use `enum` with associated values; document the pattern                                |

## Open Questions

1. Does `compact-encoding-swift` expose `Primitive.Frame()`, `Primitive.Record()`, and fixed-width numeric primitives? (Answer required before Phase 1 tasks start.)
2. Should optional fields use `T?` or provide explicit default values (e.g., `0` for numbers)? The JS codegen returns `null`/`0`/`false` defaults — Swift optionals are idiomatic but change the API surface. **Current recommendation:** use `T?` for all optional fields.
3. Should versioned types use Swift enums with associated values or a protocol? Enums require a closed set; protocols are more extensible. **Current recommendation:** enum, since the schema is closed at generation time.
