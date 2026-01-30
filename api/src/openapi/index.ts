/**
 * OpenAPI Module Entry Point
 *
 * This module provides auto-generated OpenAPI documentation from Zod schemas.
 * All schemas are registered via the schema modules, which are imported here.
 */

// Import all schemas to trigger registration
import './schemas/index.js';

// Re-export the registry and generator
export { registry, generateOpenAPIDocument } from './registry.js';
