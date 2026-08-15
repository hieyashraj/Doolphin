import { NextResponse } from "next/server";
import { requireVerifiedUser } from "@/lib/access/authorization";
import { prisma } from "@/lib/prisma";
import { getPolarConfig } from "@/lib/billing/polarEnvironment";

export async function POST() {
  try {
    const { appUser } = await requireVerifiedUser();
    const customer = await prisma.billingCustomer.findFirst({ where: { userId: appUser.id } });
    if (!customer) return NextResponse.json({ error: "Billing customer not found" }, { status: 404 });

    let config;
    try {
      config = getPolarConfig();
    } catch {
      return NextResponse.json({ error: "Billing portal is not configured" }, { status: 503 });
    }

    const response = await fetch(`${config.baseUrl}/v1/customer-sessions/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ customer_id: customer.polarCustomerId }),
    });

    if (!response.ok) return NextResponse.json({ error: "Unable to open billing portal" }, { status: 502 });
    const data = await response.json();
    return NextResponse.json({ url: data.url });
  } catch (error) {
    return NextResponse.json({ error: "Authentication required" }, { status: error.status || 401 });
  }
}

