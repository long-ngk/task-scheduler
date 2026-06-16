/**
 * Schedule routes - Express router for task scheduling API endpoints.
 *
 * Requirements: 1.1, 1.2, 2.1, 2.3, 2.5, 8.1, 8.3, 10.1, 10.3, 10.4
 */

import { Router } from 'express';
import {
  createTask,
  pushTask,
  listTasks,
  getTaskById,
  cancelTask,
  pauseTask,
  resumeTask,
} from '../controllers/schedule.controller.js';

const router = Router();

// POST /api/schedules - Create a new scheduled task
router.post('/', createTask);

// POST /api/schedules/push - Push task from external system (idempotent)
router.post('/push', pushTask);

// GET /api/schedules - List tasks with pagination and filters
router.get('/', listTasks);

// GET /api/schedules/:id - Get task by ID with execution history
router.get('/:id', getTaskById);

// PATCH /api/schedules/:id/cancel - Cancel a task
router.patch('/:id/cancel', cancelTask);

// PATCH /api/schedules/:id/pause - Pause a task
router.patch('/:id/pause', pauseTask);

// PATCH /api/schedules/:id/resume - Resume a paused task
router.patch('/:id/resume', resumeTask);

export default router;
