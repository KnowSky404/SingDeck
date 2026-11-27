const metricOrder = ["download", "upload", "connections", "memory"] as const;
const panelOrder = ["traffic", "instance", "outbounds", "logs"] as const;
const storageKey = "singdeck.overview-layout";

export type OverviewMetric = (typeof metricOrder)[number];
export type OverviewPanel = (typeof panelOrder)[number];

export interface OverviewLayout {
  metrics: readonly OverviewMetric[];
  panels: readonly OverviewPanel[];
}

export const overviewMetricLabels = {
  download: "Download",
  upload: "Upload",
  connections: "Active connections",
  memory: "Memory",
} satisfies Record<OverviewMetric, string>;

export const overviewPanelLabels = {
  traffic: "Traffic activity",
  instance: "Instance details",
  outbounds: "Outbound groups",
  logs: "Recent logs",
} satisfies Record<OverviewPanel, string>;

export const defaultOverviewLayout: OverviewLayout = {
  metrics: metricOrder,
  panels: panelOrder,
};

function isFullOrder<Card extends string>(
  order: unknown,
  expected: readonly Card[],
): order is Card[] {
  return Array.isArray(order) && order.length === expected.length &&
    expected.every((card) => order.includes(card));
}

export function parseOverviewLayout(layout: unknown): OverviewLayout | null {
  if (layout && typeof layout === "object" &&
    "metrics" in layout && isFullOrder(layout.metrics, metricOrder) &&
    "panels" in layout && isFullOrder(layout.panels, panelOrder)) {
    return { metrics: layout.metrics, panels: layout.panels };
  }
  return null;
}

export function loadOverviewLayout(): OverviewLayout {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === null) return defaultOverviewLayout;
    return parseOverviewLayout(JSON.parse(stored)) ?? defaultOverviewLayout;
  } catch {
    return defaultOverviewLayout;
  }
}
