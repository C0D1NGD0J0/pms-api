import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';

import { openApiRegistry } from './registry';
import './routes'; // Side-effect: registers all paths with the registry

export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(openApiRegistry.definitions);

  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'PropertyDesk API',
      version: '1.0.0',
      description:
        'Property Management System API — multi-tenant SaaS for landlords to manage rental payments, property maintenance, and operations.',
    },
    servers: [{ url: '/api/v1' }],
    security: [{ cookieAuth: [] }],
  });
}
