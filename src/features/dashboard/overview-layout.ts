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

export function loadOverviewLayout(): OverviewLayout {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === null) return defaultOverviewLayout;
    const layout: unknown = JSON.parse(stored);
    if (layout && typeof layout === "object" &&
      "metrics" in layout && isFullOrder(layout.metrics, metricOrder) &&
      "panels" in layout && isFullOrder(layout.panels, panelOrder)) {
      return { metrics: layout.metrics, panels: layout.panels };
    }
  } catch {
    // Storage access and parsing may fail before any preference is available.
  }
  return defaultOverviewLayout;
}

export function saveOverviewLayout({ metrics, panels }: OverviewLayout) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ metrics, panels }));
  } catch {
    // The mounted Overview can still use the selected order.
  }
}
