/**
 * Swagger/OpenAPI configuration.
 *
 * Requirement: NFR-08 - API documentation via OpenAPI/Swagger.
 */

import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Task Scheduler API',
      version: '1.0.0',
      description:
        'A Node.js task scheduling system that supports creating and running scheduled tasks with multiple task types (file read, file import, form fill, email).',
      contact: {
        name: 'Task Scheduler Team',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Local development server',
      },
    ],
    components: {
      schemas: {
        Task: {
          type: 'object',
          properties: {
            _id: { type: 'string', example: '507f1f77bcf86cd799439011' },
            type: {
              type: 'string',
              enum: ['file_read', 'file_import', 'form_fill', 'email'],
              description: 'Task type',
            },
            status: {
              type: 'string',
              enum: ['pending', 'running', 'success', 'failed', 'retrying', 'cancelled', 'paused'],
              description: 'Current task status',
            },
            payload: {
              type: 'object',
              description: 'Task-specific payload data',
            },
            scheduleAt: {
              type: 'string',
              format: 'date-time',
              description: 'One-time schedule (ISO 8601)',
              nullable: true,
            },
            cronExpr: {
              type: 'string',
              description: 'Cron expression for recurring tasks',
              example: '*/5 * * * *',
              nullable: true,
            },
            idempotencyKey: {
              type: 'string',
              description: 'Unique key to prevent duplicate task creation',
              nullable: true,
            },
            timeout: {
              type: 'number',
              description: 'Execution timeout in seconds',
              minimum: 1,
              maximum: 3600,
              default: 30,
            },
            maxRetries: {
              type: 'number',
              description: 'Maximum retry attempts',
              minimum: 0,
              maximum: 10,
              default: 3,
            },
            retryCount: {
              type: 'number',
              description: 'Current retry count',
              default: 0,
            },
            result: {
              type: 'object',
              description: 'Execution result data',
              nullable: true,
            },
            executionHistory: {
              type: 'array',
              items: { $ref: '#/components/schemas/ExecutionRecord' },
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        ExecutionRecord: {
          type: 'object',
          properties: {
            startedAt: { type: 'string', format: 'date-time' },
            completedAt: { type: 'string', format: 'date-time' },
            status: {
              type: 'string',
              enum: ['success', 'failed', 'timeout'],
            },
            error: { $ref: '#/components/schemas/TaskError' },
            correlationId: { type: 'string' },
          },
        },
        TaskError: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
            details: { type: 'object' },
          },
        },
        CreateTaskRequest: {
          type: 'object',
          required: ['type', 'payload'],
          properties: {
            type: {
              type: 'string',
              enum: ['file_read', 'file_import', 'form_fill', 'email'],
            },
            payload: { type: 'object' },
            scheduleAt: {
              type: 'string',
              format: 'date-time',
              description: 'One-time schedule (ISO 8601). Required if cronExpr is not provided.',
            },
            cronExpr: {
              type: 'string',
              description: 'Cron expression for recurring tasks. Required if scheduleAt is not provided.',
            },
            timeout: { type: 'number', minimum: 1, maximum: 3600 },
            maxRetries: { type: 'number', minimum: 0, maximum: 10 },
          },
        },
        PushTaskRequest: {
          type: 'object',
          required: ['type', 'payload', 'idempotencyKey'],
          properties: {
            type: {
              type: 'string',
              enum: ['file_read', 'file_import', 'form_fill', 'email'],
            },
            payload: { type: 'object' },
            scheduleAt: { type: 'string', format: 'date-time' },
            cronExpr: { type: 'string' },
            idempotencyKey: {
              type: 'string',
              description: 'Unique key for idempotent task creation',
              minLength: 1,
              maxLength: 256,
            },
            timeout: { type: 'number', minimum: 1, maximum: 3600 },
            maxRetries: { type: 'number', minimum: 0, maximum: 10 },
          },
        },
        TaskListResponse: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: { $ref: '#/components/schemas/Task' },
            },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'number' },
                pageSize: { type: 'number' },
                total: { type: 'number' },
                totalPages: { type: 'number' },
              },
            },
          },
        },
        HealthResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'up' },
            timestamp: { type: 'string', format: 'date-time' },
            uptime: { type: 'number' },
          },
        },
        ReadyResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ready', 'not_ready'] },
            dependencies: {
              type: 'object',
              properties: {
                mongodb: { type: 'string', enum: ['connected', 'disconnected'] },
                redis: { type: 'string', enum: ['connected', 'disconnected'] },
              },
            },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: { type: 'object' },
              },
            },
          },
        },
      },
    },
    paths: {
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Health check',
          description: 'Returns basic health status with timestamp and uptime.',
          responses: {
            '200': {
              description: 'Service is healthy',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthResponse' },
                },
              },
            },
          },
        },
      },
      '/ready': {
        get: {
          tags: ['Health'],
          summary: 'Readiness check',
          description: 'Checks MongoDB and Redis connectivity. Returns 503 if any dependency is down.',
          responses: {
            '200': {
              description: 'Service is ready',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ReadyResponse' },
                },
              },
            },
            '503': {
              description: 'Service not ready - dependencies unhealthy',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ReadyResponse' },
                },
              },
            },
          },
        },
      },
      '/api/schedules': {
        post: {
          tags: ['Schedules'],
          summary: 'Create a new scheduled task',
          description: 'Creates a new task with scheduling configuration. Must provide either scheduleAt or cronExpr.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateTaskRequest' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Task created successfully',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Task' },
                },
              },
            },
            '400': {
              description: 'Validation error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
        get: {
          tags: ['Schedules'],
          summary: 'List all tasks',
          description: 'Returns paginated list of tasks with optional status and type filters.',
          parameters: [
            {
              name: 'page',
              in: 'query',
              schema: { type: 'integer', minimum: 1, default: 1 },
              description: 'Page number',
            },
            {
              name: 'pageSize',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
              description: 'Items per page',
            },
            {
              name: 'status',
              in: 'query',
              schema: {
                type: 'string',
                enum: ['pending', 'running', 'success', 'failed', 'retrying', 'cancelled', 'paused'],
              },
              description: 'Filter by task status',
            },
            {
              name: 'type',
              in: 'query',
              schema: {
                type: 'string',
                enum: ['file_read', 'file_import', 'form_fill', 'email'],
              },
              description: 'Filter by task type',
            },
          ],
          responses: {
            '200': {
              description: 'List of tasks',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/TaskListResponse' },
                },
              },
            },
          },
        },
      },
      '/api/schedules/push': {
        post: {
          tags: ['Schedules'],
          summary: 'Push task from external system',
          description: 'Idempotent endpoint for pushing tasks. Returns 202 for new tasks, 200 for duplicates.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PushTaskRequest' },
              },
            },
          },
          responses: {
            '202': {
              description: 'New task accepted',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Task' },
                },
              },
            },
            '200': {
              description: 'Duplicate task (already exists)',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Task' },
                },
              },
            },
            '400': {
              description: 'Validation error',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/schedules/{id}': {
        get: {
          tags: ['Schedules'],
          summary: 'Get task by ID',
          description: 'Returns detailed task information including execution history.',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'Task MongoDB ObjectId',
            },
          ],
          responses: {
            '200': {
              description: 'Task details',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Task' },
                },
              },
            },
            '404': {
              description: 'Task not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/schedules/{id}/cancel': {
        patch: {
          tags: ['Schedules'],
          summary: 'Cancel a task',
          description: 'Cancels a pending or paused task. Cannot cancel tasks that are already running or completed.',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'Task MongoDB ObjectId',
            },
          ],
          responses: {
            '200': {
              description: 'Task cancelled successfully',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Task' },
                },
              },
            },
            '404': {
              description: 'Task not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '409': {
              description: 'Task cannot be cancelled in current state',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/schedules/{id}/pause': {
        patch: {
          tags: ['Schedules'],
          summary: 'Pause a task',
          description: 'Pauses a pending task. Only pending tasks can be paused.',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'Task MongoDB ObjectId',
            },
          ],
          responses: {
            '200': {
              description: 'Task paused successfully',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Task' },
                },
              },
            },
            '404': {
              description: 'Task not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '409': {
              description: 'Task cannot be paused in current state',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/schedules/{id}/resume': {
        patch: {
          tags: ['Schedules'],
          summary: 'Resume a paused task',
          description: 'Resumes a previously paused task back to pending status.',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'Task MongoDB ObjectId',
            },
          ],
          responses: {
            '200': {
              description: 'Task resumed successfully',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Task' },
                },
              },
            },
            '404': {
              description: 'Task not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '409': {
              description: 'Task cannot be resumed in current state',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
    },
  },
  apis: [], // We define everything inline above
};

export const swaggerSpec = swaggerJsdoc(options);
