export function findJobByName<T extends { name: string }>(
  jobs: readonly T[],
  wanted: string,
): T | undefined {
  return jobs.find((job) => job.name === wanted || job.name.endsWith(` / ${wanted}`));
}
