import { Schema, model, Document, Types } from 'mongoose';

// --- Enums ---

export const TaskStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
  RETRYING: 'retrying',
  CANCELLED: 'cancelled',
  PAUSED: 'paused',
} as const;

export type TaskStatusType = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TASK_STATUSES: TaskStatusType[] = Object.values(TaskStatus);

export const TaskType = {
  FILE_READ: 'file_read',
  FILE_IMPORT: 'file_import',
  FORM_FILL: 'form_fill',
  EMAIL: 'email',
} as const;

export type TaskTypeValue = (typeof TaskType)[keyof typeof TaskType];

export const TASK_TYPES: TaskTypeValue[] = Object.values(TaskType);

export const ExecutionStatus = {
  SUCCESS: 'success',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
} as const;

export type ExecutionStatusType = (typeof ExecutionStatus)[keyof typeof ExecutionStatus];

// --- Interfaces ---

export interface ITaskError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface IExecutionRecord {
  startedAt: Date;
  completedAt: Date;
  status: ExecutionStatusType;
  error?: ITaskError;
  correlationId: string;
}

export interface ITask {
  type: TaskTypeValue;
  status: TaskStatusType;
  payload: Record<string, unknown>;
  scheduleAt?: Date;
  cronExpr?: string;
  idempotencyKey?: string;
  timeout: number;
  maxRetries: number;
  retryCount: number;
  result?: Record<string, unknown>;
  executionHistory: IExecutionRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ITaskDocument extends ITask, Document {
  _id: Types.ObjectId;
}

// --- Sub-Schemas ---

const TaskErrorSchema = new Schema<ITaskError>(
  {
    code: { type: String, required: true },
    message: { type: String, required: true },
    details: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

const ExecutionRecordSchema = new Schema<IExecutionRecord>(
  {
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, required: true },
    status: {
      type: String,
      required: true,
      enum: Object.values(ExecutionStatus),
    },
    error: { type: TaskErrorSchema },
    correlationId: { type: String, required: true },
  },
  { _id: false },
);

// --- Main Schema ---

const TaskSchema = new Schema<ITaskDocument>(
  {
    type: {
      type: String,
      required: true,
      enum: TASK_TYPES,
    },
    status: {
      type: String,
      required: true,
      enum: TASK_STATUSES,
      default: TaskStatus.PENDING,
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true,
    },
    scheduleAt: { type: Date },
    cronExpr: { type: String },
    idempotencyKey: {
      type: String,
      minlength: 1,
      maxlength: 256,
    },
    timeout: {
      type: Number,
      required: true,
      default: 30,
      min: 1,
      max: 3600,
    },
    maxRetries: {
      type: Number,
      required: true,
      default: 3,
      min: 0,
      max: 10,
    },
    retryCount: {
      type: Number,
      required: true,
      default: 0,
    },
    result: { type: Schema.Types.Mixed },
    executionHistory: {
      type: [ExecutionRecordSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

// --- Indexes ---

TaskSchema.index({ status: 1, scheduleAt: 1 });
TaskSchema.index({ status: 1, type: 1 });
TaskSchema.index({ createdAt: -1 });
TaskSchema.index({ cronExpr: 1, status: 1 });

// --- Model ---

export const TaskModel = model<ITaskDocument>('Task', TaskSchema);
