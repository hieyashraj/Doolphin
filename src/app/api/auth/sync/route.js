import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { linkSupabaseIdentity } from "@/lib/access/identity";
export async function POST() { try { const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user?.email) return NextResponse.json({ error: "Authentication required" }, { status: 401 }); const appUser = await linkSupabaseIdentity({ supabaseUserId: user.id, email: user.email, name: user.user_metadata?.full_name || user.user_metadata?.name }); return NextResponse.json({ activationStatus: appUser.activationStatus, userId: appUser.id }); } catch { return NextResponse.json({ error: "Unable to synchronize account" }, { status: 409 }); } }
