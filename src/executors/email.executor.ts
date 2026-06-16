/**
 * Email Task Executor
 *
 * Sends emails via Nodemailer/SMTP to all recipients individually,
 * recording per-recipient send status (success with messageId + timestamp,
 * or failure with error message).
 *
 * Task status: all success → success; any failure → failed (with partial results preserved).
 * Error code: EMAIL_SEND_FAILED
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */

import nodemailer from 'nodemailer';
import { getConfig } from '../config/index.js';
import { ITaskDocument } from '../models/task.model.js';

// --- Interfaces ---

export interface TaskError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ExecutionResult {
  success: boolean;
  result?: Record<string, unknown>;
  error?: TaskError;
  startedAt: string; // ISO 8601
  completedAt: string; // ISO 8601
}

export interface RecipientResult {
  recipient: string;
  success: boolean;
  messageId?: string;
  timestamp?: string;
  error?: string;
}

interface EmailPayload {
  subject: string;
  body: string;
  recipients: string[];
}

// --- Email Executor ---

export class EmailExecutor {
  /**
   * Execute an email task by sending emails to all recipients individually.
   * Records per-recipient status and determines overall task success/failure.
   */
  async execute(task: ITaskDocument): Promise<ExecutionResult> {
    const startedAt = new Date().toISOString();

    const payload = task.payload as unknown as EmailPayload;
    const { subject, body, recipients } = payload;

    const config = getConfig();
    const smtpConfig = config.email.smtp;

    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: {
        user: smtpConfig.auth.user,
        pass: smtpConfig.auth.pass,
      },
    });

    const recipientResults: RecipientResult[] = [];

    for (const recipient of recipients) {
      try {
        const info = await transporter.sendMail({
          from: smtpConfig.auth.user,
          to: recipient,
          subject,
          text: body,
        });

        recipientResults.push({
          recipient,
          success: true,
          messageId: info.messageId,
          timestamp: new Date().toISOString(),
        });
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message : 'Unknown email send error';

        recipientResults.push({
          recipient,
          success: false,
          error: errorMessage,
        });
      }
    }

    const completedAt = new Date().toISOString();

    const successResults = recipientResults.filter((r) => r.success);
    const failedResults = recipientResults.filter((r) => !r.success);

    const allSuccess = failedResults.length === 0;

    const result: Record<string, unknown> = {
      totalRecipients: recipients.length,
      successCount: successResults.length,
      failedCount: failedResults.length,
      recipients: recipientResults,
    };

    if (allSuccess) {
      return {
        success: true,
        result,
        startedAt,
        completedAt,
      };
    }

    // Any failure → failed with error code EMAIL_SEND_FAILED
    return {
      success: false,
      result,
      error: {
        code: 'EMAIL_SEND_FAILED',
        message: `Failed to send email to ${failedResults.length} of ${recipients.length} recipients`,
        details: {
          failedRecipients: failedResults.map((r) => ({
            recipient: r.recipient,
            error: r.error,
          })),
        },
      },
      startedAt,
      completedAt,
    };
  }
}
