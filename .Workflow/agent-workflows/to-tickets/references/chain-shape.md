# The chain-shape ladder

Apply to every pair of slices that touch the same file, in this order — evaluate each rung only after preceding rungs fail to resolve the overlap:

1. **Session size is a hard ceiling.** Every slice must fit within a single agent session. Slices outgrowing session boundaries to dodge edges must be repartitioned or split.
2. **Remove file overlap by repartitioning.** Redraw boundaries so slices operate on disjoint file sets.
3. **Extract a prefactor slice.** When shared files represent genuine shared foundations, extract that work into an independent prerequisite slice.
4. **Add a `dependsOn` edge.** Use dependency edges to sequence unavoidable remaining file overlaps.
5. **Aim for width in the true graph.** Structure dependencies to maximize unblocked parallel execution across the batch based on actual file overlap.
