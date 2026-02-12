import { Router, Request, Response } from 'express';
import path from 'path';
import express from 'express';

const router = Router();

// Serve simulator static files
router.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html
router.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

export default router;
