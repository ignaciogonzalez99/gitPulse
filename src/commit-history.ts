// Some GitLab instances repeat commits when paging all branches. Subdivide
// full responses by time instead, and verify authorship in the caller.
export async function readCommitHistory(
  fetchWindow: (since: string, until: string) => Promise<{ data: any[]; next: number | null }>,
  since: string,
  until: string,
  maxWindows = 2048,
) {
  const commits = new Map<string, any>();
  const pending: [number, number][] = [[Date.parse(since), Date.parse(until)]];
  let windows = 0, partial = false;
  while (pending.length && windows < maxWindows) {
    const [start, end] = pending.pop()!;
    const result = await fetchWindow(new Date(start).toISOString(), new Date(end).toISOString());
    windows++;
    for (const commit of result.data) commits.set(commit.id, commit);
    if (result.next || result.data.length >= 100) {
      if (end - start <= 1000) { partial = true; continue; }
      const middle = Math.floor((start + end) / 2);
      // Inclusive boundary avoids losing commits on a split; SHA dedup handles overlap.
      pending.push([start, middle], [middle, end]);
    }
  }
  return { commits: [...commits.values()], partial: partial || pending.length > 0, windows };
}
