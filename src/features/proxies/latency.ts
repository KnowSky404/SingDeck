import type { Group, GroupItem } from "@/proto/daemon/started_service_pb";

export function testedAt(item: GroupItem): Date | undefined {
  const time = new Date(Number(item.urlTestTime) * 1000);
  if (item.urlTestTime > 0n && Number.isFinite(time.valueOf())) return time;
}

export function selectedRoute(
  root: Group,
  groups: ReadonlyMap<string, Group>,
): string[] {
  const visited = new Set([root.tag]);
  let tag = root.selected;
  while (tag && !visited.has(tag)) {
    visited.add(tag);
    tag = groups.get(tag)?.selected ?? "";
  }
  return [...visited];
}

export function latency(item: GroupItem): string {
  if (item.urlTestTime <= 0n) return "No result";
  return item.urlTestDelay < 0 ? "Invalid result" : `${item.urlTestDelay} ms`;
}

export function latencyTone(item: GroupItem) {
  if (item.urlTestTime <= 0n || item.urlTestDelay < 0) return "unknown";
  if (item.urlTestDelay < 150) return "low";
  return item.urlTestDelay < 300 ? "medium" : "high";
}

export function latencyTestWaves(
  groups: ReadonlyMap<string, Group>,
  singleTag?: string,
) {
  const workByGroup = new Map<string, { windows: number; load: number }>();
  function probeWork(tag: string): { windows: number; load: number } {
    const previous = workByGroup.get(tag);
    if (previous !== undefined) return previous;
    const pending = new Set(groups.get(tag)?.items.map((item) => item.tag));
    let jobs = 0;
    let totalWindows = 0;
    let longestJob = 1;
    let nestedLoad = 0;
    for (const member of pending) {
      const nested = groups.get(member);
      if (nested?.type === "urltest") {
        jobs++;
        const work = probeWork(member);
        totalWindows += work.windows;
        longestJob = Math.max(longestJob, work.windows);
        nestedLoad += work.load;
      } else if (nested) {
        for (const item of nested.items) pending.add(item.tag);
      } else {
        jobs++;
        totalWindows++;
      }
    }
    const work = {
      windows:
        longestJob + Math.max(0, Math.floor((totalWindows - longestJob) / 10)),
      load: Math.min(jobs, 10) + nestedLoad,
    };
    workByGroup.set(tag, work);
    return work;
  }

  if (singleTag !== undefined) {
    const windows = groups.has(singleTag) ? probeWork(singleTag).windows : 3;
    return [{ tags: [singleTag], windows }];
  }

  const allGroups = [...groups.values()];
  const references = new Set(
    allGroups.flatMap(({ items }) => items.map(({ tag }) => tag)),
  );
  const nestedTests = new Set<string>();
  const membersByGroup = new Map(
    allGroups.map(({ tag, type, items }) => {
      const members = new Set(items.map((item) => item.tag));
      for (const member of members) {
        const nested = groups.get(member);
        if (!nested) continue;
        if (type === "urltest" && nested.type === "urltest")
          nestedTests.add(member);
        for (const item of nested.items) members.add(item.tag);
      }
      return [tag, members];
    }),
  );

  const waves: { tags: string[]; windows: number }[] = [];
  const waveLoads: number[] = [];
  const lastWaveByNode = new Map<string, number>();

  function planGroup(tag: string, nodes: string[]) {
    let waveIndex = 0;
    for (const node of nodes)
      waveIndex = Math.max(waveIndex, (lastWaveByNode.get(node) ?? -1) + 1);
    const work = probeWork(tag);
    // Oversized requests run alone; sing-box controls their nested concurrency.
    const load = Math.min(Math.max(work.load, 1), 10);
    while ((waveLoads[waveIndex] ?? 0) + load > 10) waveIndex++;
    waveLoads[waveIndex] = (waveLoads[waveIndex] ?? 0) + load;
    const wave = (waves[waveIndex] ??= { tags: [], windows: 0 });
    wave.tags.push(tag);
    wave.windows = Math.max(wave.windows, work.windows);
    for (const node of nodes) lastWaveByNode.set(node, waveIndex);
  }

  const covered = new Set<string>();
  for (const { tag, type } of allGroups) {
    if (type !== "urltest") continue;
    for (const member of membersByGroup.get(tag)!) covered.add(member);
  }
  for (const { tag, type } of allGroups) {
    if (type === "urltest" || references.has(tag)) continue;
    const members = membersByGroup.get(tag)!;
    const nodes = [...members].filter((member) => !groups.has(member));
    if (nodes.every((node) => covered.has(node))) continue;
    planGroup(tag, nodes);
    for (const node of nodes) covered.add(node);
  }

  // The core stores one result per node. Run configured probes after overlapping defaults.
  for (const { tag, type } of allGroups) {
    if (type !== "urltest" || nestedTests.has(tag)) continue;
    const members = membersByGroup.get(tag)!;
    planGroup(tag, [...members].filter((member) => !groups.has(member)));
  }
  // The daemon can skip a parent's forced test while a periodic check is running.
  const nestedOrder = [...nestedTests].sort(
    (left, right) =>
      membersByGroup.get(right)!.size - membersByGroup.get(left)!.size,
  );
  for (const tag of nestedOrder) {
    const members = membersByGroup.get(tag)!;
    planGroup(tag, [...members].filter((member) => !groups.has(member)));
  }
  return waves;
}
