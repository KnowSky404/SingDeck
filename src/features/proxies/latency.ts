import type { Group, GroupItem } from "@/proto/daemon/started_service_pb";

export function testedAt(item: GroupItem): Date | undefined {
  const time = new Date(Number(item.urlTestTime) * 1000);
  if (item.urlTestTime > 0n && Number.isFinite(time.valueOf())) return time;
}

export function hasFreshLatency(previous: GroupItem, current: GroupItem): boolean {
  const { urlTestTime, urlTestDelay } = current;
  return (
    urlTestDelay >= 0 &&
    (urlTestTime > previous.urlTestTime ||
      (urlTestTime === previous.urlTestTime && urlTestDelay !== previous.urlTestDelay)) &&
    Boolean(testedAt(current))
  );
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

type InventoryLatencyHistory = {
  path: string;
  item: GroupItem;
  samples?: GroupItem[];
  matchesReportedHistory: boolean;
};

type InventoryLatencyBaseline = {
  path: string;
  samples: GroupItem[];
  reportedSamples: ReadonlyMap<string, GroupItem[]>;
};

function reportedIdentity({ tag, type }: GroupItem) {
  return JSON.stringify([tag, type]);
}

function inventoryHistorySamples(
  leaf: GroupItem,
  inventory: ReadonlyMap<string, GroupItem | undefined>,
  groups: ReadonlyMap<string, Group>,
) {
  const aliasesByMember = new Map<string, { group: Group; memberType: string }[]>();
  for (const group of groups.values()) {
    const selected = group.items.find(({ tag }) => tag === group.selected);
    if (!selected) continue;
    const aliases = aliasesByMember.get(selected.tag) ?? [];
    aliases.push({ group, memberType: selected.type });
    aliasesByMember.set(selected.tag, aliases);
  }

  // Every known alias of the leaf may report a result before its own inventory row.
  const related = new Map([[leaf.tag, leaf.type]]);
  for (const [tag, type] of related) {
    for (const { group, memberType } of aliasesByMember.get(tag) ?? []) {
      if (memberType === type) related.set(group.tag, group.type);
    }
  }
  const samples: GroupItem[] = [];
  for (const [tag, type] of related) {
    const item = inventory.get(tag);
    if (item?.type === type) samples.push(item);
  }
  for (const { items } of groups.values()) {
    for (const item of items) {
      const target = related.get(item.tag);
      if (target === undefined) continue;
      if (item.type !== target) return;
      samples.push(item);
    }
  }
  return samples;
}

export function inventoryLatencyHistory(
  tag: string,
  inventory: ReadonlyMap<string, GroupItem | undefined>,
  groups?: ReadonlyMap<string, Group>,
): InventoryLatencyHistory | undefined {
  const reported = inventory.get(tag);
  if (!reported || !groups) return;
  const root = groups.get(tag);
  const route = root ? selectedRoute(root, groups) : [tag];
  const path: [string, string][] = [];
  let expectedType = reported.type;
  for (const member of route) {
    const item = inventory.get(member);
    if (!item || item.type !== expectedType) return;
    path.push([item.tag, item.type]);

    const group = groups.get(member);
    if (!group) {
      if (item.type === "selector" || item.type === "urltest") return;
      const samples = inventoryHistorySamples(item, inventory, groups);
      return {
        path: JSON.stringify(path),
        item,
        samples,
        matchesReportedHistory: samples?.every(({ urlTestTime, urlTestDelay }) =>
          item.urlTestTime === urlTestTime && item.urlTestDelay === urlTestDelay,
        ) ?? false,
      };
    }
    if (group.type !== item.type) return;
    const selected = group.items.find(({ tag }) => tag === group.selected);
    if (!selected) return;
    expectedType = selected.type;
  }
}

export function captureInventoryLatencyHistory(
  tag: string,
  inventory: ReadonlyMap<string, GroupItem | undefined>,
  outbounds: readonly GroupItem[],
  groups?: ReadonlyMap<string, Group>,
): InventoryLatencyBaseline | undefined {
  const history = inventoryLatencyHistory(tag, inventory, groups);
  if (!history?.samples || !groups) return;

  const reportedSamples = new Map<string, GroupItem[]>();
  const capture = (item: GroupItem) => {
    const identity = reportedIdentity(item);
    const samples = reportedSamples.get(identity) ?? [];
    samples.push(item);
    reportedSamples.set(identity, samples);
  };
  for (const item of outbounds) capture(item);
  for (const { items } of groups.values()) {
    for (const item of items) capture(item);
  }
  return { path: history.path, samples: history.samples, reportedSamples };
}

export function confirmedInventoryLatency(
  baseline: InventoryLatencyBaseline,
  observed: InventoryLatencyHistory | undefined,
  confirmed: boolean,
): boolean {
  if (observed && observed.path !== baseline.path) return false;
  if (confirmed) return true;
  if (!observed?.matchesReportedHistory || !observed.samples) return false;

  const fresher = (sample: GroupItem) => hasFreshLatency(sample, observed.item);
  const observedIdentities = new Set(observed.samples.map(reportedIdentity));
  return baseline.samples.every(fresher) && [...observedIdentities].every((identity) =>
    baseline.reportedSamples.get(identity)?.every(fresher) ?? true,
  );
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
