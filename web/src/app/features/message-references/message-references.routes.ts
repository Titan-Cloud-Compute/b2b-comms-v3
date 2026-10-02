import { Routes } from '@angular/router';

/**
 * Routes for the Message Reference and Annotation feature.
 *
 * - /projects/:id/references/new   → Reference editor (placeholder; replaced by the editor unit).
 * - /projects/:id/references/:referenceId → Reference viewer panel.
 *
 * Both routes are nav: false — they open as side panels, not top-level pages.
 */
export const MESSAGE_REFERENCE_ROUTES: Routes = [
  {
    path: 'projects/:id/references/new',
    loadComponent: () =>
      import('./reference-viewer.component').then(m => m.ReferenceViewerComponent),
    data: { nav: false },
  },
  {
    path: 'projects/:id/references/:referenceId',
    loadComponent: () =>
      import('./reference-viewer.component').then(m => m.ReferenceViewerComponent),
    data: { nav: false },
  },
];
