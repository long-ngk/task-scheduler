/**
 * Schedule controller - handles HTTP request/response for task scheduling endpoints.
 *
 * Requirements: 1.1, 1.2, 2.1, 2.3, 2.5, 8.1, 8.3, 10.1, 10.3, 10.4
 */

import type { Request, Response, NextFunction } from 'express';
import {
  createTask as createTaskService,
  pushTask as pushTaskService,
  getTaskById as getTaskByIdService,
  listTasks as listTasksService,
  cancelTask as cancelTaskService,
  pauseTask as pauseTaskService,
  resumeTask as resumeTaskService,
} from '../services/task.service.js';

/**
 * POST /api/schedules
 * Create a new scheduled task.
 */
export async function createTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const task = await createTaskService(req.body);
    res.status(201).json(task);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/schedules/push
 * Push a task from an external system (idempotent).
 * Returns 202 for new tasks, 200 for duplicates.
 */
export async function pushTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await pushTaskService(req.body);

    if (result.isDuplicate) {
      res.status(200).json(result.task);
    } else {
      res.status(202).json(result.task);
    }
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/schedules
 * List tasks with pagination and optional filters.
 */
export async function listTasks(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const page = req.query.page !== undefined ? Number(req.query.page) : undefined;
    const pageSize = req.query.pageSize !== undefined ? Number(req.query.pageSize) : undefined;
    const status = req.query.status as string | undefined;
    const type = req.query.type as string | undefined;

    const result = await listTasksService({ page, pageSize, status, type });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/schedules/:id
 * Get a single task by ID with execution history.
 */
export async function getTaskById(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const task = await getTaskByIdService(id);
    res.status(200).json(task);
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/schedules/:id/cancel
 * Cancel a pending or paused task.
 */
export async function cancelTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const task = await cancelTaskService(id);
    res.status(200).json(task);
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/schedules/:id/pause
 * Pause a pending task.
 */
export async function pauseTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const task = await pauseTaskService(id);
    res.status(200).json(task);
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/schedules/:id/resume
 * Resume a paused task.
 */
export async function resumeTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const task = await resumeTaskService(id);
    res.status(200).json(task);
  } catch (error) {
    next(error);
  }
}
