import { NextResponse } from "next/server";
import { getMockSession as getServerSession } from "@/lib/getMockSession";
import { prisma } from "@/lib/prisma";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";

// MCP JSON-RPC 2.0 Server Endpoint for Claude, Cursor, and AI Agents
export async function POST(req) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = session.user.id;
    const body = await req.json();

    // Standard MCP / JSON-RPC structure
    const { jsonrpc, id, method, params } = body;

    if (jsonrpc !== "2.0") {
      return NextResponse.json({
        jsonrpc: "2.0",
        id: id || null,
        error: { code: -32600, message: "Invalid Request: jsonrpc must be '2.0'" }
      }, { status: 400 });
    }

    // 1. MCP Initialization
    if (method === "initialize") {
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: "Doolphin MCP Server",
            version: "2.4.0"
          }
        }
      });
    }

    // 2. List Available MCP Tools
    if (method === "tools/list") {
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "check_generation_status",
              description: "Check the rendering status and fetch the video asset URL for a creation ID",
              inputSchema: {
                type: "object",
                properties: {
                  creationId: { type: "string", description: "The creation ID returned from generate_video" }
                },
                required: ["creationId"]
              }
            },
            {
              name: "list_creations",
              description: "List recent generated video creations and their download links from Doolphin workspace",
              inputSchema: {
                type: "object",
                properties: {
                  limit: { type: "number", description: "Number of recent creations to return", default: 10 }
                }
              }
            },
            {
              name: "get_account_balance",
              description: "Get current user credit balance and API key status",
              inputSchema: {
                type: "object",
                properties: {}
              }
            }
          ]
        }
      });
    }

    // 3. Call Specific Tool
    if (method === "tools/call") {
      const { name, arguments: toolArgs } = params || {};

      if (name === "get_account_balance") {
        const workspace = await CreditEscrowService.ensureUserWorkspace(userId);

        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  credits: workspace.creditAccount.availableCredits,
                  providerMode: "platform-managed",
                  userId
                }, null, 2)
              }
            ]
          }
        });
      }

      if (name === "generate_video") {
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32010, message: "Direct MCP generation is disabled until the client supports GenerationRequestV1 assets and interactive preflight approval." }
        });
      }

      if (name === "check_generation_status") {
        const { creationId } = toolArgs || {};
        const creation = await prisma.creation.findFirst({ where: { id: creationId, userId } });

        if (!creation) {
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            error: { code: -32004, message: "Creation not found" }
          });
        }

        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{
              type: "text",
              text: JSON.stringify({
                creationId: creation.id,
                status: creation.status,
                stage: creation.stage,
                prompt: creation.prompt,
                modelId: creation.modelId
              }, null, 2)
            }]
          }
        });
      }

      if (name === "list_creations") {
        const { limit = 10 } = toolArgs || {};
        const list = await prisma.creation.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: Math.min(50, Math.max(1, Number(limit) || 10)), select: { id: true, title: true, generationType: true, status: true, currentStage: true, modelId: true, createdAt: true } });

        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{
              type: "text",
              text: JSON.stringify(list, null, 2)
            }]
          }
        });
      }

      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Tool not found: ${name}` }
      }, { status: 404 });
    }

    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` }
    }, { status: 404 });

  } catch (error) {
    console.error("MCP Server Error:", error);
    return NextResponse.json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: error.message || "Internal MCP error" }
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    name: "Doolphin MCP Server",
    protocol: "MCP JSON-RPC 2.0",
    docs: "Authenticated status and history tools are available. Generation requires the interactive GenerationRequestV1 preflight flow."
  });
}
