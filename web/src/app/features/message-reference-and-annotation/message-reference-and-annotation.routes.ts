import { Routes } from '@angular/router';

/** Session-only routes for the Message Reference and Annotation story. `new` must precede `:referenceId`. */
export const MESSAGE_REFERENCE_AND_ANNOTATION_ROUTES: Routes = [
  {
    path: 'projects/:id/references/new',
    loadComponent: () => import('./reference-editor.component').then((m) => m.ReferenceEditorComponent),
  },
  {
    path: 'projects/:id/references/:referenceId',
    loadComponent: () => import('./reference-viewer.component').then((m) => m.ReferenceViewerComponent),
  },
];
