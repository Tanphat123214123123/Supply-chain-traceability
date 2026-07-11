/** Hand-written OpenAPI 3.0 spec covering the public API surface. */
export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'TraceChain API',
    version: '1.0.0',
    description: 'Supply-chain traceability API with a hash-chain ledger, RBAC, and anomaly detection.',
  },
  servers: [{ url: '/api' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Actor: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['FARMER', 'PROCESSOR', 'INSPECTOR', 'DISTRIBUTOR', 'RETAILER', 'ADMIN'] },
          organization: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          isActive: { type: 'boolean' },
        },
      },
      Batch: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          productName: { type: 'string' },
          productType: { type: 'string' },
          origin: { type: 'string' },
          quantity: { type: 'number' },
          unit: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          createdBy: { type: 'string', format: 'uuid' },
          currentStage: { type: 'string', nullable: true },
          isRecalled: { type: 'boolean' },
          recallReason: { type: 'string', nullable: true },
          metadata: { type: 'object' },
        },
      },
      TraceEvent: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          batchId: { type: 'string', format: 'uuid' },
          stage: { type: 'string' },
          actorId: { type: 'string', format: 'uuid' },
          timestamp: { type: 'string', format: 'date-time' },
          location: { type: 'string' },
          notes: { type: 'string', nullable: true },
          hash: { type: 'string' },
          prevHash: { type: 'string' },
          sequenceNumber: { type: 'integer' },
        },
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
    },
  },
  paths: {
    '/auth/login': {
      post: {
        summary: 'Log in with email/password',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: { email: { type: 'string' }, password: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Access + refresh token issued' },
          '401': { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/auth/register': {
      post: {
        summary: 'Register a new actor',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { '201': { description: 'Actor created' }, '409': { description: 'Email already registered' } },
      },
    },
    '/auth/refresh': {
      post: {
        summary: 'Exchange a refresh token for a new access token',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { refreshToken: { type: 'string' } } } } } },
        responses: { '200': { description: 'New tokens issued' }, '401': { description: 'Invalid/expired refresh token' } },
      },
    },
    '/auth/logout': {
      post: {
        summary: 'Revoke a refresh token',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { refreshToken: { type: 'string' } } } } } },
        responses: { '204': { description: 'Revoked' } },
      },
    },
    '/batches': {
      get: {
        summary: 'List batches (paginated, searchable)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Paginated batch list' } },
      },
      post: {
        summary: 'Create a batch',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Batch' } } } },
        responses: { '201': { description: 'Batch created' } },
      },
    },
    '/batches/{id}': {
      get: {
        summary: 'Get a batch by id',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Batch' }, '404': { description: 'Not found' } },
      },
    },
    '/batches/{id}/recall': {
      post: {
        summary: 'Recall a batch (ADMIN only)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { reason: { type: 'string' } } } } } },
        responses: { '200': { description: 'Batch recalled' }, '403': { description: 'Not ADMIN' } },
      },
    },
    '/batches/{id}/qr': {
      get: {
        summary: 'Get an SVG QR code linking to the public provenance page',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'image/svg+xml' } },
      },
    },
    '/events': {
      post: {
        summary: 'Record a supply-chain event for a batch',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/TraceEvent' } } } },
        responses: { '201': { description: 'Event recorded' }, '403': { description: 'Role not permitted for this stage' } },
      },
    },
    '/trace/{batchId}': {
      get: {
        summary: 'Full trace (forward/backward) for a batch — requires auth',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'batchId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'direction', in: 'query', schema: { type: 'string', enum: ['forward', 'backward'] } },
        ],
        responses: { '200': { description: 'Trace result with events + anomalies + isValid' } },
      },
    },
    '/trace/public/{batchId}': {
      get: {
        summary: 'Public provenance summary — no auth required (QR-scan page)',
        parameters: [{ name: 'batchId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Public trace summary' } },
      },
    },
    '/stats/overview': {
      get: { summary: 'Aggregate counts', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Overview stats' } } },
    },
    '/stats/by-stage': {
      get: { summary: 'Event counts by stage', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Stats by stage' } } },
    },
    '/admin/audit-logs': {
      get: {
        summary: 'Paginated audit log (ADMIN only)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: { '200': { description: 'Paginated audit log' }, '403': { description: 'Not ADMIN' } },
      },
    },
  },
};
