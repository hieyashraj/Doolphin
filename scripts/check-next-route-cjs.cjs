const path = require("path");

const routePath = path.join(process.cwd(), ".next", "server", "app", "api", "internal", "reconcile", "route.js");
const route = require(routePath);

if (typeof route.handler !== "function") {
  throw new Error("Compiled reconciliation route is not CommonJS-loadable by the server launcher");
}

console.log("Compiled reconciliation route is CommonJS-loadable");
