import mongoose, { Schema, Document } from 'mongoose';

export interface IIdempotencyKey extends Document {
  key: string;
  taskId: string;
  createdAt: Date;
}

const idempotencyKeySchema = new Schema<IIdempotencyKey>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      minlength: 1,
      maxlength: 256,
    },
    taskId: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  },
);

// Unique index on key for fast lookup
idempotencyKeySchema.index({ key: 1 }, { unique: true });

// TTL index on createdAt — automatically removes documents after 24 hours
idempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

export const IdempotencyKeyModel = mongoose.model<IIdempotencyKey>(
  'IdempotencyKey',
  idempotencyKeySchema,
);
