import swaggerJsdoc from "swagger-jsdoc";

const swaggerPublicUrl = process.env.SWAGGER_SERVER_URL ?? "/";
const swaggerDevUrl = process.env.SWAGGER_DEV_SERVER ?? `http://localhost:${process.env.PORT ?? "4000"}`;

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "YNX Backend API",
      version: "1.0.0",
      description: `
Social Hub backend with Walrus content storage and Sui blockchain integration.

## Features
- **Authentication**: Wallet-based login (Sui) with JWT tokens
- **Flows**: Post text or image content
- **Social Actions**: Glow (like) and Promote content
- **Groups**: Create rooms and circles
- **Chat**: Real-time group chat with Walrus storage
- **Blockchain**: On-chain action logging via Sui
- **SSE**: Server-sent events for real-time updates

## Authentication Flow (Simplified)
1. Login with wallet: \`POST /auth\` with your walletAddress
2. Receive JWT tokens (access + refresh)
3. Use accessToken in Authorization header: \`Bearer <token>\`
4. Refresh tokens when expired: \`POST /auth/refresh\`

**Note**: Signature verification is planned for future implementation. Currently using wallet address only.

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
        url: swaggerPublicUrl,
        description: "Current host / public server"
      },
      {
        url: swaggerDevUrl,
        description: "Local development"
      }
    ],
    tags: [
      { name: "Authentication", description: "Wallet-based authentication endpoints 🔐" },
      { name: "Users", description: "User profile management" },
      { name: "Health", description: "Health check endpoints" },
      { name: "Events", description: "Server-Sent Events for real-time updates" },
      { name: "Flows", description: "Content posts (text/images)" },
      { name: "Social", description: "Social actions (glows, promotes)" },
      { name: "Groups", description: "Rooms and circles management" },
      { name: "Chat", description: "Group chat messaging 💬" },
      { name: "Verification", description: "Blockchain verification" }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT access token obtained from POST /auth"
        }
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: false },
            error: { type: "string", example: "Error message" },
            code: { type: "string", example: "ERROR_CODE" }
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
        // Authentication Schemas
        NonceResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: true },
            nonce: { 
              type: "string", 
              example: "a1b2c3d4e5f6...",
              description: "Random nonce to sign"
            },
            message: {
              type: "string",
              example: "Sign this message to authenticate with YNX\n\nWallet: 0x...\nNonce: ...",
              description: "Full message to sign with wallet"
            },
            expiresAt: {
              type: "string",
              format: "date-time",
              example: "2025-11-28T12:05:00.000Z",
              description: "Nonce expiration time (5 minutes)"
            }
          }
        },
        AuthRequest: {
          type: "object",
          required: ["walletAddress", "signature"],
          properties: {
            walletAddress: {
              type: "string",
              pattern: "^0x[a-fA-F0-9]{64}$",
              example: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
              description: "Sui wallet address"
            },
            signature: {
              type: "string",
              example: "base64EncodedSignature...",
              description: "Base64 encoded signature of the nonce message"
            }
          }
        },
        AuthResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: true },
            accessToken: {
              type: "string",
              example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
              description: "JWT access token (15 min expiry)"
            },
            refreshToken: {
              type: "string",
              example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
              description: "JWT refresh token (7 day expiry)"
            },
            expiresIn: {
              type: "integer",
              example: 900,
              description: "Access token expiry in seconds"
            },
            user: { $ref: "#/components/schemas/UserProfile" }
          }
        },
        RefreshRequest: {
          type: "object",
          required: ["refreshToken"],
          properties: {
            refreshToken: {
              type: "string",
              example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
              description: "The refresh token"
            }
          }
        },
        RefreshResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean", example: true },
            accessToken: { type: "string" },
            refreshToken: { type: "string" },
            expiresIn: { type: "integer", example: 900 }
          }
        },
        UserProfile: {
          type: "object",
          properties: {
            id: { type: "string", example: "clxxxxxxxxxx" },
            walletAddress: {
              type: "string",
              example: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
            },
            username: { 
              type: "string", 
              nullable: true,
              example: "alice_web3" 
            },
            displayName: { 
              type: "string", 
              nullable: true,
              example: "Alice" 
            },
            avatarPatchId: {
              type: "string",
              nullable: true,
              example: "abcd1234...",
              description: "Walrus patch ID for avatar image"
            },
            bio: { 
              type: "string", 
              nullable: true,
              example: "Web3 enthusiast" 
            },
            lastLoginAt: { 
              type: "string", 
              format: "date-time" 
            },
            createdAt: { 
              type: "string", 
              format: "date-time" 
            }
          }
        },
        UpdateProfileRequest: {
          type: "object",
          properties: {
            username: {
              type: "string",
              minLength: 3,
              maxLength: 30,
              pattern: "^[a-zA-Z0-9_]+$",
              example: "alice_web3",
              description: "Unique username (letters, numbers, underscores only)"
            },
            displayName: {
              type: "string",
              minLength: 1,
              maxLength: 50,
              example: "Alice"
            },
            bio: {
              type: "string",
              maxLength: 500,
              example: "Web3 enthusiast and developer"
            }
          }
        },
        // Flow Schemas
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
          required: ["flowPatchId"],
          properties: {
            flowPatchId: { type: "string", example: "0a17dcff..." },
            actorId: { type: "string", example: "actor1" }
          }
        },
        PromoteRequest: {
          type: "object",
          required: ["flowPatchId"],
          properties: {
            flowPatchId: { type: "string", example: "0a17dcff..." },
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
    },
    paths: {
      // Commented out - nonce and sign endpoints for future signature verification
      // "/auth/nonce": { ... },
      // "/auth/sign": { ... },
      "/auth": {
        post: {
          tags: ["Authentication"],
          summary: "Authenticate with wallet address (Simplified)",
          description: "Sign in or sign up using just your wallet address. If the wallet is new, a user account will be created automatically. **Note**: Signature verification is planned for future implementation.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["walletAddress"],
                  properties: {
                    walletAddress: {
                      type: "string",
                      pattern: "^0x[a-fA-F0-9]{64}$",
                      example: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
                      description: "Sui wallet address"
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Authentication successful",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AuthResponse" }
                }
              }
            },
            "401": {
              description: "Authentication failed",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/auth/refresh": {
        post: {
          tags: ["Authentication"],
          summary: "Refresh access token",
          description: "Get a new access token using a valid refresh token",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RefreshRequest" }
              }
            }
          },
          responses: {
            "200": {
              description: "Token refreshed successfully",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RefreshResponse" }
                }
              }
            },
            "401": {
              description: "Invalid or expired refresh token",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/auth/logout": {
        post: {
          tags: ["Authentication"],
          summary: "Logout user",
          description: "Invalidate the refresh token and log out",
          security: [{ BearerAuth: [] }],
          responses: {
            "200": {
              description: "Logged out successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      message: { type: "string", example: "Logged out successfully" }
                    }
                  }
                }
              }
            },
            "401": {
              description: "Not authenticated",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/auth/me": {
        get: {
          tags: ["Users"],
          summary: "Get current user profile",
          description: "Get the authenticated user's profile",
          security: [{ BearerAuth: [] }],
          responses: {
            "200": {
              description: "User profile",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      user: { $ref: "#/components/schemas/UserProfile" }
                    }
                  }
                }
              }
            },
            "401": {
              description: "Not authenticated",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        },
        patch: {
          tags: ["Users"],
          summary: "Update current user profile",
          description: "Update the authenticated user's profile (username, displayName, bio)",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdateProfileRequest" }
              }
            }
          },
          responses: {
            "200": {
              description: "Profile updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      user: { $ref: "#/components/schemas/UserProfile" }
                    }
                  }
                }
              }
            },
            "400": {
              description: "Validation error or username taken",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            },
            "401": {
              description: "Not authenticated",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/auth/me/avatar": {
        post: {
          tags: ["Users"],
          summary: "Upload user avatar",
          description: "Upload a new avatar image for the authenticated user",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    avatar: {
                      type: "string",
                      format: "binary",
                      description: "Avatar image file (JPEG, PNG, GIF, WebP)"
                    }
                  },
                  required: ["avatar"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Avatar uploaded",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      avatarPatchId: { type: "string" },
                      user: { $ref: "#/components/schemas/UserProfile" }
                    }
                  }
                }
              }
            },
            "400": {
              description: "Invalid file or no file provided",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            },
            "401": {
              description: "Not authenticated",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/users/{walletAddress}": {
        get: {
          tags: ["Users"],
          summary: "Get user by wallet address",
          description: "Get a user's public profile by their wallet address",
          parameters: [
            {
              name: "walletAddress",
              in: "path",
              required: true,
              schema: {
                type: "string",
                pattern: "^0x[a-fA-F0-9]{64}$"
              },
              description: "Sui wallet address"
            }
          ],
          responses: {
            "200": {
              description: "User profile",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      user: { $ref: "#/components/schemas/UserProfile" }
                    }
                  }
                }
              }
            },
            "404": {
              description: "User not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/flows": {
        post: {
          tags: ["Flows"],
          summary: "Create a new flow (text or image)",
          description: "Post text content or upload an image. Content is stored in Walrus and logged on-chain.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/FlowTextRequest" },
                examples: {
                  text: {
                    summary: "Text flow",
                    value: { text: "Hello world!" }
                  }
                }
              },
              "multipart/form-data": {
                schema: { $ref: "#/components/schemas/FlowImageRequest" }
              }
            }
          },
          responses: {
            "200": {
              description: "Flow created successfully",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/FlowResponse" }
                }
              }
            },
            "400": {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        },
        get: {
          tags: ["Flows"],
          summary: "List flows with pagination",
          description: "Get a paginated list of all flows",
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 20, minimum: 1, maximum: 100 },
              description: "Number of flows to return"
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0, minimum: 0 },
              description: "Number of flows to skip"
            }
          ],
          responses: {
            "200": {
              description: "List of flows",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      flows: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            hash: { type: "string" },
                            type: { type: "string", enum: ["TEXT", "IMAGE"] },
                            text: { type: "string", nullable: true },
                            imageHash: { type: "string", nullable: true },
                            caption: { type: "string", nullable: true },
                            createdAt: { type: "string", format: "date-time" }
                          }
                        }
                      },
                      total: { type: "integer" },
                      limit: { type: "integer" },
                      offset: { type: "integer" }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/flows/{hash}": {
        get: {
          tags: ["Flows"],
          summary: "Get a specific flow by hash",
          description: "Retrieve a single flow by its Walrus hash",
          parameters: [
            {
              name: "hash",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Walrus hash of the flow"
            }
          ],
          responses: {
            "200": {
              description: "Flow details",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      flow: {
                        type: "object",
                        properties: {
                          hash: { type: "string" },
                          type: { type: "string" },
                          text: { type: "string", nullable: true },
                          imageHash: { type: "string", nullable: true },
                          createdAt: { type: "string", format: "date-time" }
                        }
                      }
                    }
                  }
                }
              }
            },
            "404": {
              description: "Flow not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/glows": {
        post: {
          tags: ["Social"],
          summary: "Glow (like) a flow",
          description: "Like/glow a flow. Creates a Glow record and logs action on-chain.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GlowRequest" }
              }
            }
          },
          responses: {
            "200": {
              description: "Glow created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      tx: { $ref: "#/components/schemas/ChainTx" }
                    }
                  }
                }
              }
            },
            "400": {
              description: "Validation error or already glowed",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/promotes": {
        post: {
          tags: ["Social"],
          summary: "Promote a flow",
          description: "Promote/boost a flow. Creates a Promote record and logs action on-chain.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PromoteRequest" }
              }
            }
          },
          responses: {
            "200": {
              description: "Promote created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      tx: { $ref: "#/components/schemas/ChainTx" }
                    }
                  }
                }
              }
            },
            "400": {
              description: "Validation error or already promoted",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/groups/rooms": {
        post: {
          tags: ["Groups"],
          summary: "Create a new room",
          description: "Create a public room for group discussions",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GroupRequest" }
              }
            }
          },
          responses: {
            "200": {
              description: "Room created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      groupId: { type: "string", example: "grp_room_123" }
                    }
                  }
                }
              }
            }
          }
        },
        get: {
          tags: ["Groups"],
          summary: "List all rooms",
          description: "Get a list of all public rooms",
          responses: {
            "200": {
              description: "List of rooms",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      groups: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            type: { type: "string", example: "room" },
                            name: { type: "string" },
                            createdAt: { type: "string", format: "date-time" }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/groups/circles": {
        post: {
          tags: ["Groups"],
          summary: "Create a new circle",
          description: "Create a private circle for group discussions",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GroupRequest" }
              }
            }
          },
          responses: {
            "200": {
              description: "Circle created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      groupId: { type: "string", example: "grp_circle_456" }
                    }
                  }
                }
              }
            }
          }
        },
        get: {
          tags: ["Groups"],
          summary: "List all circles",
          description: "Get a list of all circles",
          responses: {
            "200": {
              description: "List of circles",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      groups: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            type: { type: "string", example: "circle" },
                            name: { type: "string" },
                            createdAt: { type: "string", format: "date-time" }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/groups/join": {
        post: {
          tags: ["Groups"],
          summary: "Join a group",
          description: "Join a room or circle",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/JoinRequest" }
              }
            }
          },
          responses: {
            "200": {
              description: "Joined successfully",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SuccessResponse" }
                }
              }
            }
          }
        }
      },
      "/chat": {
        post: {
          tags: ["Chat"],
          summary: "Send a chat message",
          description: "Send a message to a group. Message is stored in Walrus and logged on-chain.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ChatRequest" }
              }
            }
          },
          responses: {
            "200": {
              description: "Message sent",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ChatResponse" }
                }
              }
            },
            "400": {
              description: "Validation error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/health": {
        get: {
          tags: ["Health"],
          summary: "Health check",
          description: "Check if the API is running",
          responses: {
            "200": {
              description: "API is healthy",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      message: { type: "string", example: "YNX Backend is running" }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/verify/{txId}": {
        get: {
          tags: ["Verification"],
          summary: "Verify a blockchain transaction",
          description: "Verify if a transaction exists on the blockchain",
          parameters: [
            {
              name: "txId",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Transaction ID to verify"
            }
          ],
          responses: {
            "200": {
              description: "Verification result",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      exists: { type: "boolean" },
                      network: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/events": {
        get: {
          tags: ["Events"],
          summary: "Server-Sent Events stream",
          description: "Subscribe to real-time events (SSE). Events include new flows, glows, promotes, and chat messages.",
          responses: {
            "200": {
              description: "Event stream",
              content: {
                "text/event-stream": {
                  schema: {
                    type: "string",
                    example: "data: {\"type\":\"flow\",\"data\":{...}}\n\n"
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  apis: ["./src/index.ts"]
};

export const swaggerSpec = swaggerJsdoc(options);
