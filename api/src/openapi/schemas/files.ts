/**
 * File upload schemas - Presigned URL-based file uploads to S3
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DateTimeSchema } from './common.js';

// ============== File Upload ==============

export const UploadRequestSchema = z.object({
  filename: z.string().min(1).max(255).openapi({
    description: 'Original filename',
    example: 'screenshot.png',
  }),
  mimeType: z.string().min(1).max(100).openapi({
    description: 'MIME type of the file',
    example: 'image/png',
  }),
  sizeBytes: z.number().int().positive().max(1073741824).openapi({
    description: 'File size in bytes (max 1GB)',
    example: 1024000,
  }),
}).openapi('UploadRequest');

registry.register('UploadRequest', UploadRequestSchema);

export const UploadResponseSchema = z.object({
  uploadUrl: z.string().url().openapi({
    description: 'Presigned URL to PUT the file (expires in 15 minutes)',
  }),
  fileId: UuidSchema.openapi({
    description: 'File ID to use when referencing this file',
  }),
  publicUrl: z.string().url().openapi({
    description: 'URL where the file will be accessible after upload',
  }),
}).openapi('UploadResponse');

registry.register('UploadResponse', UploadResponseSchema);

export const FileMetadataSchema = z.object({
  id: UuidSchema,
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  uploadedBy: UuidSchema,
  documentId: UuidSchema.nullable().openapi({
    description: 'Document this file is attached to',
  }),
  publicUrl: z.string().url(),
  createdAt: DateTimeSchema,
}).openapi('FileMetadata');

registry.register('FileMetadata', FileMetadataSchema);

// ============== Register File Endpoints ==============

registry.registerPath({
  method: 'post',
  path: '/files/upload',
  tags: ['Files'],
  summary: 'Get presigned upload URL',
  description: 'Request a presigned URL to upload a file. Upload the file via PUT to the returned URL.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: UploadRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Upload URL and file metadata',
      content: {
        'application/json': {
          schema: UploadResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid request or blocked file type',
      content: {
        'application/json': {
          schema: z.object({
            error: z.string(),
            blockedExtensions: z.array(z.string()).optional(),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/files/{fileId}/attach',
  tags: ['Files'],
  summary: 'Attach file to document',
  description: 'Associate an uploaded file with a document.',
  request: {
    params: z.object({
      fileId: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            documentId: UuidSchema,
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'File attached',
      content: {
        'application/json': {
          schema: FileMetadataSchema,
        },
      },
    },
    404: {
      description: 'File or document not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/files/{fileId}',
  tags: ['Files'],
  summary: 'Get file metadata',
  request: {
    params: z.object({
      fileId: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'File metadata',
      content: {
        'application/json': {
          schema: FileMetadataSchema,
        },
      },
    },
    404: {
      description: 'File not found',
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/files/{fileId}',
  tags: ['Files'],
  summary: 'Delete file',
  description: 'Delete a file. Only the uploader or an admin can delete.',
  request: {
    params: z.object({
      fileId: UuidSchema,
    }),
  },
  responses: {
    204: {
      description: 'File deleted',
    },
    403: {
      description: 'Forbidden - not the uploader or admin',
    },
    404: {
      description: 'File not found',
    },
  },
});
