# Task List: hyperschema-swift feature parity

## Phase 1: Primitive Type Expansion

- [x] **1.1** Verify compact-encoding-swift primitive coverage (Frame, Record, fixed-width ints/floats) — XS
- [ ] **1.2** Add `int`, `uint8/16/32`, `float32`, `float64` to codegen + update fixture filter — S

**Checkpoint 1:** Fixtures 4, 13, 14, 15, 30, 31 green. `npm run test:swift` passes.

## Phase 2: Optional Fields with Flags

- [ ] **2.1** Classify fields, compute flagsPosition, emit flags bitfield in generated code — M
- [ ] **2.2** Emit optional fields as `T?` in Swift struct and init — S
- [ ] **2.3** Conditional encode/decode driven by flags word — M

**Checkpoint 2:** Fixtures 11, 16, 18 green. `npm run test:cross-language` passes.

## Phase 3: Enums

- [ ] **3.1** Generate numeric enums with codec — S
- [ ] **3.2** Generate string enums with codec — XS

**Checkpoint 3:** Fixtures 21, 22 green.

## Phase 4: Records

- [ ] **4.1** Verify compact-encoding-swift Record support — XS
- [ ] **4.2** Generate record codecs — S

**Checkpoint 4:** Fixtures 23, 24 green.

## Phase 5: Framing

- [ ] **5.1** Add Primitive.Frame wrapper for non-compact struct fields — S

**Checkpoint 5:** All nested-struct fixtures pass with correct framing.

## Phase 6: Compact Flag

- [ ] **6.1** Use fixed-size flags word for compact structs — XS

**Checkpoint 6:** Fixture 3 green.

## Phase 7: Inline Fields

- [ ] **7.1** Generate inline codec for compact struct fields — M

**Checkpoint 7:** Fixture 12 green.

## Phase 8: Versioned Types

- [ ] **8.1** Generate versioned type dispatch — M

**Checkpoint 8:** Fixture 26 green. All 28 fixture categories pass or documented as deferred.
