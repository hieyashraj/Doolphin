import React from "react";
import { notFound, redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/access/authorization";
import { prisma } from "@/lib/prisma";

/**
 * Admin Operations Console.
 * Section 24 Compliance.
 *
 * This page renders customer emails, credit balances, provider jobs and system
 * state. It previously had NO access check at all — anyone who typed /admin saw
 * all of it. The gate below is the authority (it runs a Prisma isAdmin lookup,
 * which the edge proxy cannot); the proxy adds a cheaper anonymous turn-away.
 *
 * A non-admin (including a perfectly valid paying customer) gets a 404, not a
 * 403: there is no reason to confirm to a curious logged-in user that an admin
 * console exists at this path. Only an unauthenticated visitor is sent to sign
 * in, because they may be an admin who simply is not logged in yet.
 */

export const revalidate = 0;

export default async function AdminPage() {
  try {
    await requireAdminUser();
  } catch (error) {
    if (error?.code === "UNAUTHENTICATED") redirect("/sign-in?next=/admin");
    notFound();
  }

  let creations = [];
  let providerJobs = [];
  let outboxRows = [];
  let circuitBreakers = [];
  let creditAccounts = [];

  try {
    creations = await prisma.creation.findMany({
      take: 20,
      orderBy: { createdAt: "desc" },
      include: { variants: true, user: true },
    });
    providerJobs = await prisma.providerJob.findMany({
      take: 20,
      orderBy: { createdAt: "desc" },
    });
    outboxRows = await prisma.queueOutbox.findMany({
      take: 20,
      orderBy: { createdAt: "desc" },
    });
    circuitBreakers = await prisma.circuitBreakerState.findMany();
    creditAccounts = await prisma.creditAccount.findMany({ take: 10 });
  } catch (err) {
    console.error("Admin page query error:", err.message);
  }

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif", backgroundColor: "#0f172a", color: "#f8fafc", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 28, fontWeight: "bold", marginBottom: 16 }}>Doolphin Admin Operations Console</h1>
      
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginBottom: 24 }}>
        <div style={{ background: "#1e293b", padding: 16, borderRadius: 8 }}>
          <h3>Total Creations</h3>
          <p style={{ fontSize: 24, fontWeight: "bold" }}>{creations.length}</p>
        </div>
        <div style={{ background: "#1e293b", padding: 16, borderRadius: 8 }}>
          <h3>Provider Jobs</h3>
          <p style={{ fontSize: 24, fontWeight: "bold" }}>{providerJobs.length}</p>
        </div>
        <div style={{ background: "#1e293b", padding: 16, borderRadius: 8 }}>
          <h3>Outbox Pending / Locked</h3>
          <p style={{ fontSize: 24, fontWeight: "bold" }}>{outboxRows.filter(r => r.status !== 'DISPATCHED').length}</p>
        </div>
      </div>

      <h2 style={{ fontSize: 20, marginBottom: 12 }}>Recent Creations</h2>
      <div style={{ background: "#1e293b", borderRadius: 8, padding: 16, marginBottom: 24, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #334155" }}>
              <th style={{ padding: 8 }}>ID</th>
              <th style={{ padding: 8 }}>Type</th>
              <th style={{ padding: 8 }}>User</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Stage</th>
              <th style={{ padding: 8 }}>Created At</th>
            </tr>
          </thead>
          <tbody>
            {creations.map((c) => (
              <tr key={c.id} style={{ borderBottom: "1px solid #334155" }}>
                <td style={{ padding: 8 }}>{c.id}</td>
                <td style={{ padding: 8 }}>{c.generationType}</td>
                <td style={{ padding: 8 }}>{c.user?.email || c.userId}</td>
                <td style={{ padding: 8 }}>
                  <span style={{
                    padding: "2px 8px",
                    borderRadius: 4,
                    background: c.status === "COMPLETED" ? "#166534" : c.status === "FAILED" ? "#991b1b" : "#854d0e"
                  }}>
                    {c.status}
                  </span>
                </td>
                <td style={{ padding: 8 }}>{c.currentStage || "-"}</td>
                <td style={{ padding: 8 }}>{new Date(c.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {creations.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 16, textAlign: "center" }}>No creations recorded yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 20, marginBottom: 12 }}>Circuit Breaker States</h2>
      <div style={{ background: "#1e293b", borderRadius: 8, padding: 16, overflowX: "auto" }}>
        {circuitBreakers.length === 0 ? <p>All circuits CLOSED and healthy.</p> : (
          <ul>
            {circuitBreakers.map((cb) => (
              <li key={cb.id}>{cb.provider} ({cb.internalModelId || "global"}): {cb.state}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
