import { Routes } from '@angular/router';

/** Session-only routes for the File Explorer story. */
export const FILE_EXPLORER_ROUTES: Routes = [
  {
    path: 'projects/:id/files',
    loadComponent: () => import('./file-explorer.component').then((m) => m.FileExplorerComponent),
  },
  {
    path: 'projects/:id/files/:folderId',
    loadComponent: () => import('./file-explorer.component').then((m) => m.FileExplorerComponent),
  },
];
