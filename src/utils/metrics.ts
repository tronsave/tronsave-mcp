/**
 * Minimal in-process Prometheus metrics (no extra dependency). Counters reset on restart;
 * scrape `/metrics` per replica.
 */
type Labels = Record<string, string>;

const counters = new Map<string, { help: string; values: Map<string, number> }>();

const labelKey = (labels: Labels): string =>
  Object.keys(labels)
    .sort()
    .map((key) => `${key}="${labels[key].replace(/["\\\n]/g, "_")}"`)
    .join(",");

const counter = (name: string, help: string) => {
  counters.set(name, { help, values: new Map() });
  return (labels: Labels, by = 1): void => {
    const entry = counters.get(name);
    if (!entry) {
      return;
    }
    const key = labelKey(labels);
    entry.values.set(key, (entry.values.get(key) ?? 0) + by);
  };
};

export const metrics = {
  toolCalls: counter("tronsave_mcp_tool_calls_total", "Tool calls by tool and outcome (ok|error)."),
  toolErrors: counter("tronsave_mcp_tool_errors_total", "Tool errors by tool and error code."),
  toolDurationMs: counter("tronsave_mcp_tool_duration_ms_total", "Cumulative tool latency in milliseconds."),
  httpRequests: counter("tronsave_mcp_http_requests_total", "MCP HTTP requests by route and status."),
};

export const renderMetrics = (): string => {
  const lines: string[] = [];
  for (const [name, { help, values }] of counters) {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`);
    for (const [key, value] of values) {
      lines.push(key ? `${name}{${key}} ${value}` : `${name} ${value}`);
    }
  }
  return `${lines.join("\n")}\n`;
};
