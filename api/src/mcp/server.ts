#!/usr/bin/env node
/**
 * Ship MCP Server - Auto-generated from OpenAPI spec
 *
 * This server dynamically generates MCP tools by fetching the OpenAPI specification
 * from a running Ship instance. As the API changes, tools automatically stay in sync.
 *
 * Configuration is loaded from ~/.claude/.env:
 *   SHIP_API_TOKEN=ship_xxx
 *   SHIP_URL=https://ship.example.com
 *
 * Claude Code config (~/.claude.json):
 *   {
 *     "mcpServers": {
 *       "ship": {
 *         "command": "npx",
 *         "args": ["tsx", "/path/to/ship/api/src/mcp/server.ts"]
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// OpenAPI types (inline to avoid external dependency)
interface OpenAPIObject {
  paths?: Record<string, PathItemObject>;
  components?: { schemas?: Record<string, SchemaObject> };
}
interface PathItemObject {
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  patch?: OperationObject;
  delete?: OperationObject;
}
interface OperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: ParameterObject[];
  requestBody?: { content?: { 'application/json'?: { schema?: SchemaObject | ReferenceObject } } };
}
interface ParameterObject {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: SchemaObject | ReferenceObject;
}
interface SchemaObject {
  type?: string;
  description?: string;
  properties?: Record<string, SchemaObject | ReferenceObject>;
  required?: string[];
  items?: SchemaObject | ReferenceObject;
  enum?: unknown[];
}
interface ReferenceObject {
  $ref: string;
}

interface Config {
  token: string;
  url: string;
}

/**
 * Load configuration from ~/.claude/.env
 */
function loadConfig(): Config {
  const envPath = join(homedir(), '.claude', '.env');

  if (!existsSync(envPath)) {
    console.error('Error: ~/.claude/.env not found');
    console.error('Create it with SHIP_API_TOKEN and SHIP_URL');
    process.exit(1);
  }

  const content = readFileSync(envPath, 'utf-8');
  const lines = content.split('\n');

  let token = '';
  let url = 'http://localhost:3000';

  for (const line of lines) {
    if (line.startsWith('SHIP_API_TOKEN=')) {
      token = line.substring('SHIP_API_TOKEN='.length).trim();
    } else if (line.startsWith('SHIP_URL=')) {
      url = line.substring('SHIP_URL='.length).trim();
    }
  }

  if (!token) {
    console.error('Error: SHIP_API_TOKEN not found in ~/.claude/.env');
    process.exit(1);
  }

  return { token, url };
}

// Load config at startup
const CONFIG = loadConfig();

/**
 * Fetch OpenAPI spec from the Ship instance
 */
async function fetchOpenAPISpec(): Promise<OpenAPIObject> {
  const url = `${CONFIG.url}/api/openapi.json`;
  console.error(`Fetching OpenAPI spec from ${url}...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenAPI spec: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<OpenAPIObject>;
}

interface ToolOperation {
  method: string;
  path: string;
  operation: OperationObject;
}

// Map of tool name -> operation details
const toolOperations = new Map<string, ToolOperation>();

/**
 * Convert path to operationId-style string
 * e.g., "/accountability/action-items" -> "accountability_action_items"
 */
function pathToOperationId(method: string, path: string): string {
  // Remove path parameters and convert to snake_case
  const cleanPath = path
    .replace(/\{[^}]+\}/g, '') // Remove {param}
    .replace(/\//g, '_')       // / -> _
    .replace(/-/g, '_')        // - -> _
    .replace(/_+/g, '_')       // Collapse multiple _
    .replace(/^_|_$/g, '');    // Trim leading/trailing _

  return `${method}_${cleanPath}`;
}

/**
 * Convert OpenAPI operationId to MCP tool name
 * e.g., "get_issues" stays as "get_issues", "postAuthLogin" -> "post_auth_login"
 */
function toToolName(operationId: string): string {
  // Already snake_case
  if (operationId.includes('_')) {
    return `ship_${operationId}`;
  }
  // Convert camelCase to snake_case
  return `ship_${operationId.replace(/([A-Z])/g, '_$1').toLowerCase()}`;
}

/**
 * Check if a schema is a reference object
 */
function isReference(schema: SchemaObject | ReferenceObject): schema is ReferenceObject {
  return '$ref' in schema;
}

/**
 * Resolve a $ref to its schema definition
 */
function resolveRef(ref: string, spec: OpenAPIObject): SchemaObject | undefined {
  // Format: #/components/schemas/SchemaName
  const parts = ref.split('/');
  if (parts[0] !== '#' || parts[1] !== 'components' || parts[2] !== 'schemas') {
    return undefined;
  }
  const schemaName = parts[3];
  if (!schemaName || !spec.components?.schemas) {
    return undefined;
  }
  return spec.components.schemas[schemaName] as SchemaObject | undefined;
}

/**
 * Convert OpenAPI schema to JSON Schema for MCP tool input
 */
function openApiToJsonSchema(
  schema: SchemaObject | ReferenceObject | undefined,
  spec: OpenAPIObject
): Record<string, unknown> {
  if (!schema) {
    return { type: 'object', properties: {} };
  }

  if (isReference(schema)) {
    const resolved = resolveRef(schema.$ref, spec);
    if (resolved) {
      return openApiToJsonSchema(resolved, spec);
    }
    return { type: 'object', properties: {} };
  }

  // Handle basic types
  const result: Record<string, unknown> = {};

  if (schema.type) {
    result.type = schema.type;
  }

  if (schema.description) {
    result.description = schema.description;
  }

  if (schema.enum) {
    result.enum = schema.enum;
  }

  if (schema.properties) {
    result.properties = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      (result.properties as Record<string, unknown>)[key] = openApiToJsonSchema(
        prop as SchemaObject | ReferenceObject,
        spec
      );
    }
  }

  if (schema.required) {
    result.required = schema.required;
  }

  if (schema.items) {
    result.items = openApiToJsonSchema(schema.items as SchemaObject | ReferenceObject, spec);
  }

  return result;
}

/**
 * Build MCP tool input schema from OpenAPI operation
 */
function buildInputSchema(operation: OperationObject, spec: OpenAPIObject): Tool['inputSchema'] {
  const properties: Record<string, object> = {};
  const required: string[] = [];

  // Add path and query parameters
  if (operation.parameters) {
    for (const param of operation.parameters) {
      const p = param as ParameterObject;
      if (p.name && p.schema) {
        const paramSchema = openApiToJsonSchema(p.schema as SchemaObject | ReferenceObject, spec);
        if (p.description) {
          paramSchema.description = p.description;
        }
        properties[p.name] = paramSchema as object;
        if (p.required) {
          required.push(p.name);
        }
      }
    }
  }

  // Add request body properties
  if (operation.requestBody && 'content' in operation.requestBody) {
    const content = operation.requestBody.content;
    const jsonContent = content['application/json'];
    if (jsonContent?.schema) {
      const bodySchema = openApiToJsonSchema(jsonContent.schema as SchemaObject | ReferenceObject, spec);

      // Flatten body properties into the main schema
      if (bodySchema.properties && typeof bodySchema.properties === 'object') {
        for (const [key, value] of Object.entries(bodySchema.properties)) {
          properties[key] = value as object;
        }
      }
      if (Array.isArray(bodySchema.required)) {
        required.push(...bodySchema.required);
      }
    }
  }

  return {
    type: 'object' as const,
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

/**
 * Generate MCP tools from OpenAPI spec
 */
function generateTools(openApiSpec: OpenAPIObject): Tool[] {
  const tools: Tool[] = [];

  for (const [path, pathItem] of Object.entries(openApiSpec.paths || {})) {
    if (!pathItem) continue;

    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;

    for (const method of methods) {
      const operation = pathItem[method] as OperationObject | undefined;
      if (!operation) continue;

      // Use operationId if available, otherwise generate from method+path
      const operationId = operation.operationId || pathToOperationId(method, path);
      const toolName = toToolName(operationId);
      const description = [
        operation.summary,
        operation.description,
        `[${method.toUpperCase()} ${path}]`,
      ]
        .filter(Boolean)
        .join('\n\n');

      // Store operation details for execution
      toolOperations.set(toolName, { method, path, operation });

      tools.push({
        name: toolName,
        description,
        inputSchema: buildInputSchema(operation, openApiSpec),
      });
    }
  }

  return tools;
}

/**
 * Execute an API call based on tool name and arguments
 */
async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const toolOp = toolOperations.get(toolName);
  if (!toolOp) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const { method, path, operation } = toolOp;

  // Build URL with path parameters replaced
  let url = `${CONFIG.url}/api${path}`;
  const queryParams: Record<string, string> = {};
  const bodyParams: Record<string, unknown> = {};

  // Categorize arguments into path, query, and body params
  if (operation.parameters) {
    for (const param of operation.parameters) {
      const p = param as ParameterObject;
      const value = args[p.name];
      if (value !== undefined) {
        if (p.in === 'path') {
          url = url.replace(`{${p.name}}`, encodeURIComponent(String(value)));
        } else if (p.in === 'query') {
          queryParams[p.name] = String(value);
        }
      }
    }
  }

  // Remaining args go to body (for POST/PUT/PATCH)
  const paramNames = new Set(
    (operation.parameters || []).map((p) => (p as ParameterObject).name)
  );
  for (const [key, value] of Object.entries(args)) {
    if (!paramNames.has(key)) {
      bodyParams[key] = value;
    }
  }

  // Build query string
  const queryString = new URLSearchParams(queryParams).toString();
  if (queryString) {
    url += `?${queryString}`;
  }

  // Make the request
  const fetchOptions: RequestInit = {
    method: method.toUpperCase(),
    headers: {
      'Authorization': `Bearer ${CONFIG.token}`,
      'Content-Type': 'application/json',
    },
  };

  if (['post', 'put', 'patch'].includes(method) && Object.keys(bodyParams).length > 0) {
    fetchOptions.body = JSON.stringify(bodyParams);
  }

  const response = await fetch(url, fetchOptions);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `API error ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

// Start the server
async function main() {
  // Fetch OpenAPI spec from Ship instance
  const openApiSpec = await fetchOpenAPISpec();

  // Generate tools from spec
  const mcpTools = generateTools(openApiSpec);
  console.error(`Generated ${mcpTools.length} tools from OpenAPI spec`);

  // Create the MCP server
  const server = new Server(
    {
      name: 'ship',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: mcpTools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await executeToolCall(name, (args || {}) as Record<string, unknown>);

      return {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Connect transport and start
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Ship MCP server running on ${CONFIG.url}`);
}

main().catch((error) => {
  console.error('Failed to start Ship MCP server:', error);
  process.exit(1);
});
