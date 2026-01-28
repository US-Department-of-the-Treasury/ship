import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Ship API',
      version: '1.0.0',
      description: 'API for Ship - Project and Sprint Management Platform',
    },
    servers: [
      {
        url: '/api',
        description: 'API base path',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'session',
        },
      },
      schemas: {
        Document: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            document_type: {
              type: 'string',
              enum: ['wiki', 'issue', 'program', 'project', 'sprint', 'person', 'standup', 'sprint_review'],
            },
            content: { type: 'object' },
            properties: { type: 'object' },
            parent_id: { type: 'string', format: 'uuid', nullable: true },
            project_id: { type: 'string', format: 'uuid', nullable: true },
            sprint_id: { type: 'string', format: 'uuid', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        Issue: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            content: { type: 'object' },
            state: {
              type: 'string',
              enum: ['backlog', 'planned', 'in_progress', 'in_review', 'done', 'cancelled'],
            },
            priority: { type: 'string', enum: ['low', 'medium', 'high'] },
            estimate: { type: 'number', nullable: true },
            project_id: { type: 'string', format: 'uuid', nullable: true },
            sprint_id: { type: 'string', format: 'uuid', nullable: true },
            assignee_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
          },
        },
        Sprint: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            sprint_number: { type: 'integer', description: 'Sprint sequence number (dates computed from workspace.sprint_start_date)' },
            plan: { type: 'string', nullable: true, description: 'What will we learn or validate?' },
            workspace_sprint_start_date: { type: 'string', format: 'date', description: 'Workspace anchor date for computing sprint dates' },
          },
        },
        Project: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            content: { type: 'object' },
            plan: { type: 'string', nullable: true },
            ice_impact: { type: 'number', nullable: true },
            ice_confidence: { type: 'number', nullable: true },
            ice_ease: { type: 'number', nullable: true },
            status: { type: 'string', enum: ['active', 'completed', 'on_hold', 'cancelled'] },
          },
        },
        Standup: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            content: { type: 'object' },
            author_id: { type: 'string', format: 'uuid' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        SprintReview: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            content: { type: 'object' },
            hypothesis_validated: { type: 'boolean', nullable: true },
            sprint_id: { type: 'string', format: 'uuid' },
            owner_id: { type: 'string', format: 'uuid' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  },
  apis: ['./src/routes/*.ts', './src/app.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);

export function setupSwagger(app: Express): void {
  // Serve swagger UI at /api/docs
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Ship API Documentation',
  }));

  // Serve the raw OpenAPI spec
  app.get('/api/openapi.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  app.get('/api/openapi.yaml', (req, res) => {
    res.setHeader('Content-Type', 'text/yaml');
    const yaml = jsonToYaml(swaggerSpec);
    res.send(yaml);
  });
}

// Simple JSON to YAML converter (no external dependency needed)
function jsonToYaml(obj: unknown, indent = 0): string {
  const spaces = '  '.repeat(indent);

  if (obj === null) return 'null';
  if (obj === undefined) return '';
  if (typeof obj === 'string') {
    if (obj.includes('\n') || obj.includes(':') || obj.includes('#')) {
      return `"${obj.replace(/"/g, '\\"')}"`;
    }
    return obj;
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map(item => {
      const value = jsonToYaml(item, indent + 1);
      if (typeof item === 'object' && item !== null) {
        return `${spaces}- ${value.trim().replace(/^/, '').replace(/\n/g, `\n${spaces}  `)}`;
      }
      return `${spaces}- ${value}`;
    }).join('\n');
  }

  if (typeof obj === 'object') {
    const entries = Object.entries(obj);
    if (entries.length === 0) return '{}';
    return entries.map(([key, value]) => {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return `${spaces}${key}:\n${jsonToYaml(value, indent + 1)}`;
      } else if (Array.isArray(value)) {
        return `${spaces}${key}:\n${jsonToYaml(value, indent + 1)}`;
      } else {
        return `${spaces}${key}: ${jsonToYaml(value, indent)}`;
      }
    }).join('\n');
  }

  return String(obj);
}

// Generate static openapi.yaml file
export function generateOpenApiFile(): void {
  const yaml = jsonToYaml(swaggerSpec);
  const outputPath = path.join(__dirname, '..', 'openapi.yaml');
  fs.writeFileSync(outputPath, yaml, 'utf-8');
  console.log(`OpenAPI spec written to ${outputPath}`);
}
