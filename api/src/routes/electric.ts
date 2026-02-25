import { Router, Request, Response } from 'express';
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client';
import { authMiddleware } from '../middleware/auth.js';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

const ELECTRIC_URL = process.env.ELECTRIC_URL || 'http://localhost:3060';

// Shape configurations: map of shape name to Electric shape params.
// Shapes are defined server-side so the client cannot request arbitrary tables.
interface ShapeConfig {
  table: string;
  where?: string;
  columns?: string;
}

const SHAPE_CONFIGS: Record<string, ShapeConfig> = {
  workspaces: {
    table: 'workspaces',
  },
  'documents-persons': {
    table: 'documents',
    where: "document_type::text='person'",
    columns: 'id,workspace_id,document_type,title,properties,created_at,updated_at,archived_at,deleted_at',
  },
  'documents-weekly-plans': {
    table: 'documents',
    where: "document_type::text='weekly_plan'",
    columns: 'id,workspace_id,document_type,title,properties,created_at,updated_at,archived_at,deleted_at',
  },
  'documents-weekly-retros': {
    table: 'documents',
    where: "document_type::text='weekly_retro'",
    columns: 'id,workspace_id,document_type,title,properties,created_at,updated_at,archived_at,deleted_at',
  },
  'documents-standups': {
    table: 'documents',
    where: "document_type::text='standup'",
    columns: 'id,workspace_id,document_type,title,properties,created_at,updated_at,archived_at,deleted_at',
  },
  'documents-sprints': {
    table: 'documents',
    where: "document_type::text='sprint'",
    columns: 'id,workspace_id,document_type,title,properties,created_at,updated_at,archived_at,deleted_at',
  },
  'documents-projects': {
    table: 'documents',
    where: "document_type::text='project'",
    columns: 'id,workspace_id,document_type,title,properties,ticket_number,created_at,updated_at,archived_at,deleted_at',
  },
};

/**
 * GET /api/electric/:shapeName
 *
 * Proxies shape requests to the Electric sync engine.
 * - Auth is enforced via session/token middleware
 * - Shape configuration (table, where, columns) is defined server-side
 * - Electric protocol params are forwarded from the client per ELECTRIC_PROTOCOL_QUERY_PARAMS
 */
router.get('/:shapeName', authMiddleware, async (req: Request, res: Response) => {
  const shapeName = req.params.shapeName as string;

  const config = SHAPE_CONFIGS[shapeName];
  if (!config) {
    res.status(404).json({ error: `Unknown shape: ${shapeName}` });
    return;
  }

  // Build the Electric URL with shape config + forwarded protocol params
  const url = new URL(`${ELECTRIC_URL}/v1/shape`);
  url.searchParams.set('table', config.table);
  if (config.where) {
    url.searchParams.set('where', config.where);
  }
  if (config.columns) {
    url.searchParams.set('columns', config.columns);
  }

  // Forward all Electric protocol params from the client request
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === 'string' && ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      url.searchParams.set(key, value);
    }
  }

  try {
    const response = await fetch(url.toString());

    // Forward status code
    res.status(response.status);

    // Forward response headers (important for Electric caching and streaming)
    // Strip CORS headers (Express CORS middleware handles these) and encoding headers
    response.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (
        lower === 'content-encoding' ||
        lower === 'content-length' ||
        lower === 'transfer-encoding' ||
        lower.startsWith('access-control-')
      ) {
        return;
      }
      res.setHeader(key, value);
    });

    // Stream the response body
    if (response.body) {
      const reader = response.body.getReader();
      const pump = async (): Promise<void> => {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        res.write(value);
        return pump();
      };
      await pump();
    } else {
      const text = await response.text();
      res.send(text);
    }
  } catch (err) {
    console.error(`Electric proxy error for shape ${shapeName}:`, err);
    res.status(502).json({ error: 'Failed to connect to Electric sync engine' });
  }
});

export default router;
