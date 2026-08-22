# The chain-shape ladder

Applied to every pair of slices that touch the same file, in this order — each rung is tried only
after the one above it has failed to resolve the overlap:

1. **Session-sized is a hard ceiling.** It outranks every rung below it: a slice never grows past
   what fits in one agent session to relieve overlap elsewhere. Repartition, extract, or edge — but
   never inflate a slice past session size to make a chain problem disappear.
2. **Remove the file overlap by repartitioning** before reaching for an edge at all. Two slices
   that both need to touch the same file are, more often than not, a sign the file boundary was
   drawn in the wrong place — redraw it first.
3. **Extract a prefactor slice if overlap survives repartitioning.** When the shared file really is
   shared work, pull that work into its own slice that the others depend on, rather than leaving
   two slices to collide on it directly.
4. **Add an edge only for overlap that still remains** after repartitioning and extraction have
   both been tried. A `dependsOn` edge is the last resort, not the first move.
5. **Draw the true graph and aim for width.** The goal is not the shortest chain on paper — it's a
   graph that reflects real overlap and leaves as much of the batch unblocked and running in
   parallel as the actual dependencies allow.
