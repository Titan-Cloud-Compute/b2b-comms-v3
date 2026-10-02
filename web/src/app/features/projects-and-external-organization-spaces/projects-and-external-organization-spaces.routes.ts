import { Routes } from '@angular/router';

/** Session-only routes for the Projects and External Organization Spaces story. */
export const PROJECTS_AND_EXTERNAL_ORGANIZATION_SPACES_ROUTES: Routes = [
  {
    path: 'projects',
    pathMatch: 'full',
    loadComponent: () => import('./project-list.component').then((m) => m.ProjectListComponent),
  },
  {
    path: 'projects/:id',
    loadComponent: () => import('./project-detail.component').then((m) => m.ProjectDetailComponent),
  },
];
