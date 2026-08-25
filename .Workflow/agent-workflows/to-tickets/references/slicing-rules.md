# Slicing rules

1. **Prefactor slices ship with their first consumer.** A prefactor slice must be accompanied in the same batch by the feature slice that required it.
2. **Dependencies point inward only.** Every `dependsOn` index must reference a slice within the same batch.
3. **Acceptance criteria are self-contained.** Assertions must verify against this repository checkout and the slice's declared file claims.
4. **Wide refactors use expand-contract.** Mechanical changes fanning across numerous call sites sequence as: expand —> batch migrate —> contract.
