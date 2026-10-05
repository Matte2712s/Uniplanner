import type { FastifyInstance } from 'fastify';
import type { FolderDto } from '@planner/shared';
import { folderInputSchema, folderPatchSchema, isSelfOrDescendant, MAX_FOLDERS_PER_USER } from '@planner/shared';
import type { Db } from '../db/index.ts';
import {
  countUserFolders,
  createUserFolder,
  deleteUserFolder,
  getUserFolder,
  listUserFolders,
  moveUserFolder,
  renameUserFolder,
  type FolderRow,
} from '../db/repo.ts';
import { requireUser } from '../auth/session.ts';

function toDto(row: FolderRow): FolderDto {
  return { id: row.id, name: row.name, position: row.position, parentId: row.parent_id };
}

function toNode(row: FolderRow) {
  return { id: row.id, name: row.name, position: row.position, parentId: row.parent_id };
}

export function registerFolderRoutes(app: FastifyInstance, db: Db): void {
  // POST /api/folders
  app.post('/api/folders', async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    if (countUserFolders(db, user.id) >= MAX_FOLDERS_PER_USER) {
      return reply.code(400).send({ error: 'too_many_folders' });
    }
    const parsed = folderInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const folder = createUserFolder(db, user.id, parsed.data.name);
    return { folder: toDto(folder) };
  });

  // PUT /api/folders/:id
  app.put('/api/folders/:id', async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' });
    const existing = getUserFolder(db, user.id, id);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const parsed = folderPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    if (parsed.data.name !== undefined) {
      renameUserFolder(db, user.id, id, parsed.data.name);
    }
    if (parsed.data.parentId !== undefined || parsed.data.index !== undefined) {
      // Index alone reorders within the current parent
      const parentId = parsed.data.parentId === undefined ? existing.parent_id : parsed.data.parentId;
      if (parentId != null) {
        if (!getUserFolder(db, user.id, parentId)) return reply.code(400).send({ error: 'invalid_folder' });
        const nodes = listUserFolders(db, user.id).map(toNode);
        if (isSelfOrDescendant(nodes, id, parentId)) return reply.code(400).send({ error: 'invalid_parent' });
      }
      moveUserFolder(db, user.id, id, parentId, parsed.data.index);
    }
    return { folder: toDto(getUserFolder(db, user.id, id)!) };
  });

  // DELETE /api/folders/:id
  app.delete('/api/folders/:id', async (req, reply) => {
    const user = requireUser(db, req, reply);
    if (!user) return;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid_id' });
    if (!getUserFolder(db, user.id, id)) return reply.code(404).send({ error: 'not_found' });
    deleteUserFolder(db, user.id, id);
    return { ok: true };
  });
}
