import { Routes } from '@angular/router';

/** Session-only routes for the Projects and External Organization Spaces story. */
export const PROJECTS_AND_EXTERNAL_ORGANIZATION_SPACES_ROUTES: Routes = [
  {
    path: 'projects',
    pathMatch: 'full',
    loadComponent: () => import('./project-list.component').then((m) => m.ProjectListComponent),
  },
  {
    // Must come BEFORE projects/:id so the static segment wins over the param.
    path: 'projects/new',
    loadComponent: () => import('./project-new.component').then((m) => m.ProjectNewComponent),
  },
  {
    path: 'projects/:id',
    loadComponent: () => import('./project-detail.component').then((m) => m.ProjectDetailComponent),
  },
];
