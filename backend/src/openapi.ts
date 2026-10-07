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
          assignedToActorId: { type: 'string', format: 'uuid', nullable: true },
          headHash: {
            type: 'string',
            pattern: '^[0-9a-f]{64}$',
            description: 'Hash of the last event, i.e. the recorded head of the batch chain (genesis = 64 zeros).',
          },
          eventCount: { type: 'integer', description: 'Number of events in the chain; a verifier compares it to the events returned.' },
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
          data: { type: 'object' },
          hash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          prevHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          sequenceNumber: { type: 'integer' },
          hashVersion: {
            type: 'integer',
            enum: [1, 2],
            description:
              '2 = SHA-256 over the RFC 8785 canonical JSON of {v, salt, batchId, sequenceNumber, prevHash, stage, actorId, timestamp, location, notes, data} — recomputable by anyone. 1 = legacy HMAC, server-verifiable only.',
          },
          salt: { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'Per-event random salt (v2 only).' },
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
        summary: 'Sign up — found a new workspace (becomes its ADMIN) or redeem an invitation (role from the invite)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  {
                    type: 'object',
                    required: ['mode', 'name', 'email', 'password', 'organization', 'tenantSlug', 'tenantName'],
                    properties: {
                      mode: { type: 'string', enum: ['workspace'] },
                      name: { type: 'string' },
                      email: { type: 'string' },
                      password: { type: 'string', minLength: 8 },
                      organization: { type: 'string' },
                      tenantSlug: { type: 'string', pattern: '^[a-z0-9-]+$' },
                      tenantName: { type: 'string' },
                    },
                  },
                  {
                    type: 'object',
                    required: ['mode', 'name', 'email', 'password', 'organization', 'inviteCode'],
                    properties: {
                      mode: { type: 'string', enum: ['invite'] },
                      name: { type: 'string' },
                      email: { type: 'string' },
                      password: { type: 'string', minLength: 8 },
                      organization: { type: 'string' },
                      inviteCode: { type: 'string', example: 'K7QF-M2XP-9A3R' },
                    },
                  },
                ],
              },
            },
          },
        },
        responses: {
          '201': { description: 'Actor created' },
          '403': { description: 'Invitation was issued for a different email' },
          '404': { description: 'Invitation invalid or expired' },
          '409': { description: 'Email already registered, workspace slug taken, or invitation already used' },
        },
      },
    },
    '/auth/invitations/{code}': {
      get: {
        summary: 'Preview an invitation (workspace name + granted role) — no auth required',
        parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Invitation preview' }, '404': { description: 'Invalid or expired' } },
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
          {
            name: 'stage',
            in: 'query',
            schema: { type: 'string', enum: ['NONE', 'HARVEST', 'PROCESSING', 'QUALITY_CHECK', 'PACKAGING', 'DISTRIBUTION', 'RETAIL'] },
          },
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
        summary: 'Recall a batch (ADMIN or INSPECTOR)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { reason: { type: 'string' } } } } } },
        responses: { '200': { description: 'Batch recalled' }, '403': { description: 'Not ADMIN or INSPECTOR' } },
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
        responses: { '200': { description: 'Public trace summary with the consumer-facing journey (organizations, places, dates, whitelisted facts)' } },
      },
    },
    '/stats/overview': {
      get: { summary: 'Aggregate counts', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Overview stats' } } },
    },
    '/stats/by-stage': {
      get: { summary: 'Event counts by stage', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Stats by stage' } } },
    },
    '/stats/attention': {
      get: {
        summary: 'Stalled batches (no activity for 3+ days) and the open-anomaly count',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Attention summary' } },
      },
    },
    '/admin/invitations': {
      get: { summary: 'Recent invitations (ADMIN only)', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Invitations' } } },
      post: {
        summary: 'Issue an invitation (ADMIN only) — the raw code is returned once',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['role'],
                properties: {
                  role: { type: 'string', enum: ['FARMER', 'PROCESSOR', 'INSPECTOR', 'DISTRIBUTOR', 'RETAILER', 'ADMIN'] },
                  email: { type: 'string' },
                  note: { type: 'string' },
                  expiresInDays: { type: 'integer', minimum: 1, maximum: 30, default: 7 },
                },
              },
            },
          },
        },
        responses: { '201': { description: '{ invitation, code }' } },
      },
    },
    '/admin/invitations/{id}': {
      delete: {
        summary: 'Revoke an unused invitation (ADMIN only)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Revoked' }, '409': { description: 'Already used or revoked' } },
      },
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
