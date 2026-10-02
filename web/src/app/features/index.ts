import { Routes } from '@angular/router';

/**
 * Feature route registry.
 *
 * Each story appends its Angular routes to this array.
 * app.routes.ts spreads FEATURE_ROUTES before the wildcard catch-all so new
 * feature routes are picked up automatically.
 *
 * Example (in features/my-feature/my-feature.routes.ts):
 *
 *   import { FEATURE_ROUTES } from '../index';
 *   FEATURE_ROUTES.push({ path: 'my-feature', loadComponent: () => ... });
 *
 * Or add routes here directly.
 */
export const FEATURE_ROUTES: Routes = [
  // Projects and External Organization Spaces. 'projects/new' must precede 'projects/:id'.
  {
    path: 'projects',
    loadComponent: () =>
      import('./projects/project-list.component').then(m => m.ProjectListComponent),
  },
  {
    path: 'projects/new',
    loadComponent: () =>
      import('./projects/project-new.component').then(m => m.ProjectNewComponent),
  },
  {
    path: 'projects/:id',
    loadComponent: () =>
      import('./projects/project-space.component').then(m => m.ProjectSpaceComponent),
  },
];
