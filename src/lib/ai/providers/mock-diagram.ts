// The diagram half of the mock provider (V3 feature 01 §3): no network, no key, and an answer built from the request, so
// a test can predict it. A prompt about food delivery gets the reference architecture the spec uses as its fixture (6
// sections, 24 boxes, 31 connections at standard detail); a "flow" request gets a checkout flow; anything else a small
// web app. Markers in the request make it misbehave on purpose: `[mock:dangling]` adds a connection to a box that does
// not exist (so the preview shows a warning), and `[mock:dupid]` gives two boxes one id (which the checks refuse).

type N = [id: string, label: string, kind: string, tech: string | null, section: string];
type E = [from: string, to: string, label: string | null, dashed?: boolean];

const SECTIONS = [
  { id: "clients", label: "Clients", tone: "blue" },
  { id: "edge", label: "Edge", tone: "teal" },
  { id: "services", label: "Services" },
  { id: "messaging", label: "Messaging", tone: "violet" },
  { id: "data", label: "Data", tone: "teal" },
  { id: "external", label: "External", tone: "slate" },
] as const;

const STANDARD_NODES: N[] = [
  ["customer-app", "Customer app", "client", "React Native", "clients"],
  ["restaurant-app", "Restaurant app", "client", "React", "clients"],
  ["courier-app", "Courier app", "client", "Kotlin and Swift", "clients"],
  ["admin-web", "Admin dashboard", "client", "Next.js", "clients"],
  ["cdn", "CDN", "gateway", "CloudFront", "edge"],
  ["api-gateway", "API gateway", "gateway", "Kong", "edge"],
  ["order-svc", "Order service", "service", "Node.js", "services"],
  ["catalog-svc", "Restaurant catalog", "service", "Go", "services"],
  ["tracking-svc", "Delivery tracking", "service", "Go", "services"],
  ["payment-svc", "Payment service", "service", "Java", "services"],
  ["notification-svc", "Notification service", "service", "Node.js", "services"],
  ["user-svc", "User service", "service", "Node.js", "services"],
  ["dispatch-svc", "Dispatch service", "service", "Python", "services"],
  ["event-bus", "Event bus", "queue", "Kafka", "messaging"],
  ["job-queue", "Job queue", "queue", "RabbitMQ", "messaging"],
  ["orders-db", "Orders database", "database", "PostgreSQL", "data"],
  ["catalog-search", "Search index", "database", "Elasticsearch", "data"],
  ["cache", "Cache", "cache", "Redis", "data"],
  ["geo-store", "Location store", "database", "PostGIS", "data"],
  ["media", "Menu images", "storage", "S3", "data"],
  ["analytics", "Analytics warehouse", "database", "BigQuery", "data"],
  ["stripe", "Payment gateway", "external", "Stripe", "external"],
  ["maps", "Maps API", "external", "Google Maps", "external"],
  ["push", "Push and SMS", "external", "FCM and Twilio", "external"],
];

const STANDARD_EDGES: E[] = [
  ["customer-app", "cdn", "static assets"],
  ["admin-web", "cdn", "static assets"],
  ["customer-app", "api-gateway", "HTTPS"],
  ["restaurant-app", "api-gateway", "HTTPS"],
  ["courier-app", "api-gateway", "HTTPS"],
  ["admin-web", "api-gateway", "HTTPS"],
  ["api-gateway", "user-svc", "sign in, profiles"],
  ["api-gateway", "catalog-svc", "browse menus"],
  ["api-gateway", "order-svc", "place orders"],
  ["api-gateway", "tracking-svc", "live location"],
  ["order-svc", "orders-db", "SQL"],
  ["order-svc", "cache", "carts"],
  ["order-svc", "payment-svc", "charge"],
  ["payment-svc", "stripe", "payments API"],
  ["payment-svc", "event-bus", "payment status"],
  ["order-svc", "event-bus", "order placed"],
  ["event-bus", "dispatch-svc", "assign courier"],
  ["event-bus", "notification-svc", "events"],
  ["event-bus", "analytics", "events", true],
  ["dispatch-svc", "tracking-svc", "assignments"],
  ["dispatch-svc", "maps", "routes"],
  ["tracking-svc", "geo-store", "positions"],
  ["tracking-svc", "cache", "latest position"],
  ["tracking-svc", "event-bus", "location events"],
  ["catalog-svc", "catalog-search", "queries"],
  ["catalog-svc", "media", "images"],
  ["catalog-svc", "cache", "menu cache"],
  ["notification-svc", "push", "push, SMS"],
  ["notification-svc", "job-queue", "retries"],
  ["job-queue", "dispatch-svc", "retries"],
  ["user-svc", "cache", "sessions"],
];

const OVERVIEW_IDS = new Set([
  "customer-app",
  "restaurant-app",
  "courier-app",
  "api-gateway",
  "order-svc",
  "tracking-svc",
  "payment-svc",
  "orders-db",
  "event-bus",
  "stripe",
]);

const EXTRA_NODES: N[] = [
  ["auth-svc", "Auth service", "service", "Keycloak", "services"],
  ["review-svc", "Reviews", "service", "Node.js", "services"],
  ["promo-svc", "Promotions", "service", "Node.js", "services"],
  ["inventory-svc", "Menu availability", "service", "Go", "services"],
  ["reviews-db", "Reviews database", "database", "MongoDB", "data"],
  ["sessions", "Session store", "cache", "Redis", "data"],
  ["metrics", "Metrics", "service", "Prometheus", "observability"],
  ["logs", "Logs", "service", "Loki", "observability"],
  ["traces", "Traces", "service", "Tempo", "observability"],
  ["dashboards", "Dashboards", "service", "Grafana", "observability"],
  ["email", "Email", "external", "Amazon SES", "external"],
  ["kyc", "Courier checks", "external", "Onfido", "external"],
];
const EXTRA_EDGES: E[] = [
  ["api-gateway", "auth-svc", "tokens"],
  ["api-gateway", "review-svc", "ratings"],
  ["review-svc", "reviews-db", "reads, writes"],
  ["order-svc", "promo-svc", "discounts"],
  ["catalog-svc", "inventory-svc", "availability"],
  ["notification-svc", "email", "receipts"],
  ["auth-svc", "sessions", "sessions"],
  ["courier-app", "kyc", "verification", true],
  ["metrics", "dashboards", "queries"],
  ["logs", "dashboards", "queries"],
  ["traces", "dashboards", "queries"],
];

function node(n: N) {
  return {
    id: n[0],
    label: n[1],
    kind: n[2],
    ...(n[3] ? { tech: n[3] } : {}),
    section: n[4],
  };
}
const edge = (e: E) => ({
  from: e[0],
  to: e[1],
  ...(e[2] ? { label: e[2] } : {}),
  ...(e[3] ? { dashed: true } : {}),
});

function foodDelivery(detail: string) {
  let nodes = STANDARD_NODES;
  let edges = STANDARD_EDGES;
  let sections: { id: string; label: string; tone?: string }[] = [...SECTIONS];
  if (detail === "overview") {
    nodes = nodes.filter((n) => OVERVIEW_IDS.has(n[0]));
    edges = edges.filter((e) => OVERVIEW_IDS.has(e[0]) && OVERVIEW_IDS.has(e[1]));
  } else if (detail === "detailed") {
    nodes = [...nodes, ...EXTRA_NODES];
    edges = [...edges, ...EXTRA_EDGES];
    sections = [...sections, { id: "observability", label: "Observability", tone: "amber" }];
  }
  return {
    title: "Reference architecture for a food delivery app",
    layout: "architecture",
    sections,
    nodes: nodes.map(node),
    edges: edges.map(edge),
  };
}

function checkoutFlow() {
  const step = (id: string, label: string, kind = "process") => ({ id, label, kind });
  return {
    title: "Checkout flow with payment retries",
    layout: "flow",
    sections: [],
    nodes: [
      step("start", "Start checkout", "start-end"),
      step("review", "Review the cart"),
      step("details", "Enter payment details"),
      step("charge", "Charge the card"),
      step("paid", "Payment accepted?", "decision"),
      step("retry", "Retry, up to three times"),
      step("confirm", "Confirm the order"),
      step("notify", "Send the receipt"),
      step("cancel", "Cancel the order"),
      step("end", "Done", "start-end"),
    ],
    edges: [
      { from: "start", to: "review" },
      { from: "review", to: "details" },
      { from: "details", to: "charge" },
      { from: "charge", to: "paid" },
      { from: "paid", to: "confirm", label: "yes" },
      { from: "paid", to: "retry", label: "no" },
      { from: "retry", to: "charge", label: "try again" },
      { from: "retry", to: "cancel", label: "gave up" },
      { from: "confirm", to: "notify" },
      { from: "notify", to: "end" },
      { from: "cancel", to: "end" },
    ],
  };
}

function genericApp() {
  return {
    title: "Reference architecture for a web app",
    layout: "architecture",
    sections: [
      { id: "clients", label: "Clients" },
      { id: "services", label: "Services" },
      { id: "data", label: "Data" },
    ],
    nodes: [
      { id: "browser", label: "Web app", kind: "client", tech: "React", section: "clients" },
      { id: "api", label: "API", kind: "service", tech: "Node.js", section: "services" },
      {
        id: "worker",
        label: "Background worker",
        kind: "service",
        tech: "Node.js",
        section: "services",
      },
      { id: "db", label: "Database", kind: "database", tech: "PostgreSQL", section: "data" },
      { id: "cache", label: "Cache", kind: "cache", tech: "Redis", section: "data" },
    ],
    edges: [
      { from: "browser", to: "api", label: "HTTPS" },
      { from: "api", to: "db", label: "SQL" },
      { from: "api", to: "cache", label: "reads" },
      { from: "api", to: "worker", label: "jobs" },
      { from: "worker", to: "db", label: "SQL" },
    ],
  };
}

export function mockDiagram(fixture: {
  prompt?: string;
  layout?: string;
  detail?: string;
  note?: string;
}) {
  const prompt = (fixture.prompt ?? "").toLowerCase();
  const detail = fixture.detail ?? "standard";
  const out: {
    title: string;
    layout: string;
    sections: unknown[];
    nodes: { id: string; [k: string]: unknown }[];
    edges: unknown[];
  } =
    fixture.layout === "flow"
      ? checkoutFlow()
      : /food|delivery|swiggy|zomato/.test(prompt)
        ? foodDelivery(detail)
        : genericApp();
  if (prompt.includes("[mock:dangling]")) {
    out.edges.push({ from: out.nodes[0]!.id, to: "does-not-exist", label: "points nowhere" });
    out.edges.push({ from: "also-missing", to: out.nodes[1]!.id });
  }
  if (prompt.includes("[mock:dupid]")) out.nodes.push({ ...out.nodes[0]! });
  return out;
}

// The refine half (slice C): changes built from the instruction, so a test can predict them. "cache" adds a Redis cache
// connected to the first service; markers make it do something else on purpose: `[mock:remove:<id>]`,
// `[mock:rename:<id>:<new label>]`, `[mock:none]` (no changes), `[mock:bad]` (a connection to a box that does not exist,
// and a change to one that is not there, which the checks leave out and say so). Anything else adds a Monitoring box.
export function mockRefine(fixture: {
  instruction?: string;
  spec?: { nodes?: { id: string; kind: string }[] };
}) {
  const text = fixture.instruction ?? "";
  const nodes = fixture.spec?.nodes ?? [];
  const anchor = (nodes.find((n) => n.kind === "service") ?? nodes[0])?.id ?? "";
  if (text.includes("[mock:none]")) return { ops: [] };
  const remove = /\[mock:remove:([a-z0-9-]+)\]/.exec(text);
  if (remove) return { ops: [{ op: "removeNode", id: remove[1] }] };
  const rename = /\[mock:rename:([a-z0-9-]+):([^\]]+)\]/.exec(text);
  if (rename) return { ops: [{ op: "updateNode", id: rename[1], label: rename[2] }] };
  if (text.includes("[mock:bad]")) {
    return {
      ops: [
        {
          op: "addNode",
          id: "audit-log",
          label: "Audit log",
          kind: "database",
          tech: "PostgreSQL",
        },
        { op: "addEdge", from: anchor, to: "audit-log", label: "writes" },
        { op: "addEdge", from: anchor, to: "ghost-box", label: "calls" },
        { op: "updateNode", id: "ghost-box", label: "Nope" },
      ],
    };
  }
  if (/cache/i.test(text)) {
    return {
      ops: [
        { op: "addNode", id: "refine-cache", label: "Cache", kind: "cache", tech: "Redis" },
        { op: "addEdge", from: anchor, to: "refine-cache", label: "reads, writes" },
      ],
    };
  }
  return {
    ops: [
      {
        op: "addNode",
        id: "refine-monitor",
        label: "Monitoring",
        kind: "service",
        tech: "Grafana",
      },
      { op: "addEdge", from: anchor, to: "refine-monitor", label: "metrics", dashed: true },
    ],
  };
}
