import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "YNX Backend API",
      version: "1.0.0",
      description: `
Social Hub backend with Walrus content storage and Sui blockchain integration.

## Features
- **Flows**: Post text or image content
- **Social Actions**: Glow (like) and Promote content
- **Groups**: Create rooms and circles
- **Chat**: Real-time group chat with Walrus storage
- **Blockchain**: On-chain action logging via Sui
- **SSE**: Server-sent events for real-time updates

## Chat Feature
✅ **Yes, this backend supports chat!**
- Send messages to groups (rooms/circles)
- Messages stored in Walrus (content-addressed)
- On-chain logging via Sui blockchain
- Real-time events via SSE endpoint
      `,
      contact: {
        name: "API Support",
        url: "https://github.com/VeraLuxDAO/veralux-backend"
      }
    },
    servers: [
      {
        url: "http://localhost:{port}",
        description: "Development server",
        variables: {
          port: {
            default: "4000",
            description: "Server port"
          }
        }
      }
    ],
    tags: [
      { name: "Health", description: "Health check endpoints" },
      { name: "Events", description: "Server-Sent Events for real-time updates" },
      { name: "Flows", description: "Content posts (text/images)" },
      { name: "Social", description: "Social actions (glows, promotes)" },
      { name: "Groups", description: "Rooms and circles management" },
      { name: "Chat", description: "Group chat messaging 💬" },
      { name: "Verification", description: "Blockchain verification" }
    ],
    components: {
      schemas: {
        Error: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: false },
            error: { type: "string", example: "Error message" }
          }
        },
        SuccessResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: true }
          }
        },
        ChainTx: {
          type: "object",
          properties: {
            txId: { type: "string", example: "stub-uuid-1234" },
            network: { 
              type: "string", 
              enum: ["stub", "sui", "evm"],
              example: "sui"
            }
          }
        },
        FlowTextRequest: {
          type: "object",
          required: ["text"],
          properties: {
            text: {
              type: "string",
              minLength: 1,
              maxLength: 2000,
              example: "Hello world!"
            }
          }
        },
        FlowImageRequest: {
          type: "object",
          properties: {
            image: {
              type: "string",
              format: "binary",
              description: "Image file (max 10MB)"
            },
            caption: {
              type: "string",
              maxLength: 2000,
              example: "Beautiful sunset"
            }
          }
        },
        FlowResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: true },
            hash: { type: "string", example: "0a17dcff..." },
            type: { type: "string", enum: ["TEXT", "IMAGE"] },
            imageHash: { type: "string", example: "896a5a79..." },
            tx: { $ref: "#/components/schemas/ChainTx" }
          }
        },
        GlowRequest: {
          type: "object",
          required: ["flowHash"],
          properties: {
            flowHash: { type: "string", example: "0a17dcff..." },
            actorId: { type: "string", example: "actor1" }
          }
        },
        PromoteRequest: {
          type: "object",
          required: ["flowHash"],
          properties: {
            flowHash: { type: "string", example: "0a17dcff..." },
            actorId: { type: "string", example: "actor1" }
          }
        },
        GroupRequest: {
          type: "object",
          required: ["name"],
          properties: {
            name: {
              type: "string",
              minLength: 1,
              maxLength: 80,
              example: "General Room"
            }
          }
        },
        JoinRequest: {
          type: "object",
          required: ["groupId", "memberId"],
          properties: {
            groupId: { type: "string", example: "grp_room_123" },
            memberId: { type: "string", example: "user123" }
          }
        },
        ChatRequest: {
          type: "object",
          required: ["text"],
          properties: {
            text: {
              type: "string",
              minLength: 1,
              maxLength: 2000,
              example: "Hello everyone! 👋",
              description: "Chat message text"
            },
            groupId: {
              type: "string",
              example: "grp_room_123",
              description: "Optional group ID for group chats"
            },
            actorId: {
              type: "string",
              example: "user456",
              description: "Optional actor/user ID for attribution"
            }
          }
        },
        ChatResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: true },
            hash: { 
              type: "string", 
              example: "e986f1b0...",
              description: "Walrus hash of the stored chat message"
            },
            tx: { $ref: "#/components/schemas/ChainTx" }
          }
        }
      }
    }
  },
  apis: ["./src/index.ts"]
};

export const swaggerSpec = swaggerJsdoc(options);
