// Serializable client-safe catalog. Server pricing derives its values from
// this same source; UI must not maintain a competing plan table.
export const APPROVED_PLANS = Object.freeze([
  { code: "EXPLORER", name: "Explorer", price: "$2.99", priceMicroUsd: 2_990_000, credits: 50, interval: "ONE_TIME", cadence: "One-time", seats: 1, workspaces: 1 },
  { code: "STARTER_MONTHLY", name: "Starter", price: "$29/month", priceMicroUsd: 29_000_000, credits: 700, interval: "MONTHLY", cadence: "Monthly", seats: 1, workspaces: 1 },
  { code: "STARTER_ANNUAL", name: "Starter", price: "$278.40/year", priceMicroUsd: 278_400_000, credits: 700, interval: "ANNUAL", cadence: "700 credits granted monthly", seats: 1, workspaces: 1 },
  { code: "GROWTH_MONTHLY", name: "Growth", price: "$79/month", priceMicroUsd: 79_000_000, credits: 1900, interval: "MONTHLY", cadence: "Monthly", seats: 3, workspaces: 3 },
  { code: "GROWTH_ANNUAL", name: "Growth", price: "$758.40/year", priceMicroUsd: 758_400_000, credits: 1900, interval: "ANNUAL", cadence: "1,900 credits granted monthly", seats: 3, workspaces: 3 },
  { code: "AGENCY_MONTHLY", name: "Agency", price: "$179/month", priceMicroUsd: 179_000_000, credits: 4300, interval: "MONTHLY", cadence: "Monthly", seats: 10, workspaces: 10 },
  { code: "AGENCY_ANNUAL", name: "Agency", price: "$1,718.40/year", priceMicroUsd: 1_718_400_000, credits: 4300, interval: "ANNUAL", cadence: "4,300 credits granted monthly", seats: 10, workspaces: 10 },
]);

export const PLAN_BY_CODE = Object.freeze(Object.fromEntries(APPROVED_PLANS.map((plan) => [plan.code, plan])));
export const PURCHASE_PLAN_CODES = Object.freeze(["EXPLORER", "STARTER_MONTHLY", "GROWTH_MONTHLY", "AGENCY_MONTHLY"]);
