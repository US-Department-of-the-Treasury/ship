/**
 * Workspace schemas - Multi-tenant workspace management
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DateTimeSchema, DateSchema } from './common.js';

// ============== Workspace ==============

export const WorkspaceSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  sprintStartDate: DateSchema.openapi({
    description: 'Anchor date for computing sprint numbers and dates',
  }),
  archivedAt: DateTimeSchema.nullable(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  role: z.enum(['admin', 'member']).openapi({
    description: 'Current user\'s role in this workspace',
  }),
  isSuperAdmin: z.boolean().optional().openapi({
    description: 'True if user is super-admin (can access all workspaces)',
  }),
}).openapi('Workspace');

registry.register('Workspace', WorkspaceSchema);

// ============== Workspace List Response ==============

export const WorkspaceListResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    workspaces: z.array(WorkspaceSchema),
    isSuperAdmin: z.boolean(),
  }),
}).openapi('WorkspaceListResponse');

registry.register('WorkspaceListResponse', WorkspaceListResponseSchema);

// ============== Create/Update Workspace ==============

export const CreateWorkspaceSchema = z.object({
  name: z.string().min(1).max(200),
  sprintStartDate: DateSchema.optional().openapi({
    description: 'Defaults to next Monday if not provided',
  }),
}).openapi('CreateWorkspace');

registry.register('CreateWorkspace', CreateWorkspaceSchema);

export const UpdateWorkspaceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sprintStartDate: DateSchema.optional(),
}).openapi('UpdateWorkspace');

registry.register('UpdateWorkspace', UpdateWorkspaceSchema);

// ============== Register Workspace Endpoints ==============

registry.registerPath({
  method: 'get',
  path: '/workspaces',
  tags: ['Workspaces'],
  summary: 'List workspaces',
  description: 'List all workspaces the current user has access to.',
  responses: {
    200: {
      description: 'List of workspaces',
      content: {
        'application/json': {
          schema: WorkspaceListResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/workspaces/current',
  tags: ['Workspaces'],
  summary: 'Get current workspace',
  description: 'Get the workspace currently selected in the session.',
  responses: {
    200: {
      description: 'Current workspace',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              workspace: WorkspaceSchema,
            }),
          }),
        },
      },
    },
    400: {
      description: 'No workspace selected',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/workspaces/{id}/switch',
  tags: ['Workspaces'],
  summary: 'Switch workspace',
  description: 'Switch to a different workspace. Updates the session.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Workspace switched',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              workspace: WorkspaceSchema,
            }),
          }),
        },
      },
    },
    403: {
      description: 'No access to workspace',
    },
    404: {
      description: 'Workspace not found',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/workspaces',
  tags: ['Workspaces'],
  summary: 'Create workspace',
  description: 'Create a new workspace. Requires admin privileges.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateWorkspaceSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Created workspace',
      content: {
        'application/json': {
          schema: WorkspaceSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
    },
    403: {
      description: 'Insufficient privileges',
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/workspaces/{id}',
  tags: ['Workspaces'],
  summary: 'Update workspace',
  description: 'Update workspace settings. Requires workspace admin role.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateWorkspaceSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated workspace',
      content: {
        'application/json': {
          schema: WorkspaceSchema,
        },
      },
    },
    403: {
      description: 'Not a workspace admin',
    },
    404: {
      description: 'Workspace not found',
    },
  },
});
