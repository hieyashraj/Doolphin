import { NextResponse } from "next/server";
import { AuthorizationError } from "./authorization";
export async function withAuthorization(handler) { try { return await handler(); } catch (error) { if (error instanceof AuthorizationError) return NextResponse.json({ error: error.code }, { status: error.status }); throw error; } }
