import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmailExecutor } from '../../src/executors/email.executor.js';
import { ITaskDocument } from '../../src/models/task.model.js';

// Mock nodemailer
vi.mock('nodemailer', () => {
  const sendMailMock = vi.fn();
  return {
    default: {
      createTransport: vi.fn(() => ({
        sendMail: sendMailMock,
      })),
    },
    __sendMailMock: sendMailMock,
  };
});

// Mock config
vi.mock('../../src/config/index.js', () => ({
  getConfig: vi.fn(() => ({
    email: {
      smtp: {
        host: 'smtp.test.com',
        port: 587,
        secure: false,
        auth: { user: 'test@test.com', pass: 'password' },
      },
    },
  })),
}));

function createMockTask(payload: Record<string, unknown>): ITaskDocument {
  return {
    payload,
  } as unknown as ITaskDocument;
}

describe('EmailExecutor', () => {
  let executor: EmailExecutor;
  let sendMailMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    executor = new EmailExecutor();

    // Get the sendMail mock
    const nodemailerModule = await import('nodemailer');
    const transport = nodemailerModule.default.createTransport({} as never);
    sendMailMock = transport.sendMail as ReturnType<typeof vi.fn>;
  });

  it('should return success when all emails are sent successfully', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'msg-001' });

    const task = createMockTask({
      subject: 'Test Subject',
      body: 'Test Body',
      recipients: ['user1@test.com', 'user2@test.com'],
    });

    const result = await executor.execute(task);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.startedAt).toBeDefined();
    expect(result.completedAt).toBeDefined();
    expect(result.result).toBeDefined();
    expect(result.result!.totalRecipients).toBe(2);
    expect(result.result!.successCount).toBe(2);
    expect(result.result!.failedCount).toBe(0);

    const recipients = result.result!.recipients as Array<{
      recipient: string;
      success: boolean;
      messageId?: string;
      timestamp?: string;
    }>;
    expect(recipients).toHaveLength(2);
    expect(recipients[0].success).toBe(true);
    expect(recipients[0].messageId).toBe('msg-001');
    expect(recipients[0].timestamp).toBeDefined();
    expect(recipients[1].success).toBe(true);
  });

  it('should return failure with EMAIL_SEND_FAILED when any recipient fails', async () => {
    sendMailMock
      .mockResolvedValueOnce({ messageId: 'msg-001' })
      .mockRejectedValueOnce(new Error('SMTP connection refused'));

    const task = createMockTask({
      subject: 'Test Subject',
      body: 'Test Body',
      recipients: ['user1@test.com', 'user2@test.com'],
    });

    const result = await executor.execute(task);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe('EMAIL_SEND_FAILED');
    expect(result.error!.message).toContain('1 of 2');
    expect(result.error!.details).toBeDefined();
    expect(result.result).toBeDefined();
    expect(result.result!.successCount).toBe(1);
    expect(result.result!.failedCount).toBe(1);

    // Partial results are preserved
    const recipients = result.result!.recipients as Array<{
      recipient: string;
      success: boolean;
      messageId?: string;
      error?: string;
    }>;
    expect(recipients[0].success).toBe(true);
    expect(recipients[0].messageId).toBe('msg-001');
    expect(recipients[1].success).toBe(false);
    expect(recipients[1].error).toBe('SMTP connection refused');
  });

  it('should return failure when all recipients fail', async () => {
    sendMailMock.mockRejectedValue(new Error('SMTP server down'));

    const task = createMockTask({
      subject: 'Test Subject',
      body: 'Test Body',
      recipients: ['user1@test.com', 'user2@test.com', 'user3@test.com'],
    });

    const result = await executor.execute(task);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('EMAIL_SEND_FAILED');
    expect(result.error!.message).toContain('3 of 3');
    expect(result.result!.totalRecipients).toBe(3);
    expect(result.result!.successCount).toBe(0);
    expect(result.result!.failedCount).toBe(3);

    const recipients = result.result!.recipients as Array<{
      recipient: string;
      success: boolean;
      error?: string;
    }>;
    recipients.forEach((r) => {
      expect(r.success).toBe(false);
      expect(r.error).toBe('SMTP server down');
    });
  });

  it('should handle non-Error thrown objects gracefully', async () => {
    sendMailMock.mockRejectedValue('string error');

    const task = createMockTask({
      subject: 'Test',
      body: 'Body',
      recipients: ['user@test.com'],
    });

    const result = await executor.execute(task);

    expect(result.success).toBe(false);
    const recipients = result.result!.recipients as Array<{
      recipient: string;
      success: boolean;
      error?: string;
    }>;
    expect(recipients[0].error).toBe('Unknown email send error');
  });

  it('should record ISO 8601 timestamps for startedAt and completedAt', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'msg-001' });

    const task = createMockTask({
      subject: 'Test',
      body: 'Body',
      recipients: ['user@test.com'],
    });

    const result = await executor.execute(task);

    // Verify ISO 8601 format
    expect(new Date(result.startedAt).toISOString()).toBe(result.startedAt);
    expect(new Date(result.completedAt).toISOString()).toBe(result.completedAt);
    expect(new Date(result.completedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(result.startedAt).getTime()
    );
  });

  it('should send email to a single recipient successfully', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'single-msg' });

    const task = createMockTask({
      subject: 'Single',
      body: 'Single body',
      recipients: ['solo@test.com'],
    });

    const result = await executor.execute(task);

    expect(result.success).toBe(true);
    expect(result.result!.totalRecipients).toBe(1);
    expect(result.result!.successCount).toBe(1);
    expect(result.result!.failedCount).toBe(0);
  });

  it('should include failedRecipients details in error.details', async () => {
    sendMailMock
      .mockResolvedValueOnce({ messageId: 'msg-ok' })
      .mockRejectedValueOnce(new Error('Recipient rejected'))
      .mockRejectedValueOnce(new Error('Mailbox full'));

    const task = createMockTask({
      subject: 'Multi',
      body: 'Body',
      recipients: ['a@test.com', 'b@test.com', 'c@test.com'],
    });

    const result = await executor.execute(task);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('EMAIL_SEND_FAILED');

    const details = result.error!.details as {
      failedRecipients: Array<{ recipient: string; error: string }>;
    };
    expect(details.failedRecipients).toHaveLength(2);
    expect(details.failedRecipients[0].recipient).toBe('b@test.com');
    expect(details.failedRecipients[0].error).toBe('Recipient rejected');
    expect(details.failedRecipients[1].recipient).toBe('c@test.com');
    expect(details.failedRecipients[1].error).toBe('Mailbox full');
  });
});
